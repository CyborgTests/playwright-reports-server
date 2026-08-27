/**
 * Aggregates failure categories and top error groups from `test_runs`.
 * Runs in a worker thread so the heavy scan never blocks the API
 *
 * IMPORTANT: this file is plain JavaScript (.mjs) on purpose.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';

const { dbPath, project, limit, from, to } = workerData;

const PAGE_CONTEXT_HEADER = '\n\n# Page Context';

function decodeFailureDetails(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value || null;
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    return gunzipSync(buf).toString('utf8');
  }
  return buf.toString('utf8') || null;
}

function extractDisplayMessage(failureDetailsRaw) {
  const json = decodeFailureDetails(failureDetailsRaw);
  if (!json) return '';
  try {
    const parsed = JSON.parse(json);
    let msg = String(parsed?.message ?? '');
    const headerIdx = msg.indexOf(PAGE_CONTEXT_HEADER);
    if (headerIdx > 0) msg = msg.substring(0, headerIdx);
    return msg.trim();
  } catch {
    return '';
  }
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const makeTestKey = (testId, fileId, project) => `${testId}::${fileId}::${project}`;

try {
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 5000');

  const MAX_ROWS_SCANNED = 10_000;

  const conditions = ['failure_category IS NOT NULL'];
  const params = [];
  if (from) {
    conditions.push('createdAt >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('createdAt < ?');
    params.push(to);
  }
  if (project && project !== 'all') {
    conditions.push('project = ?');
    params.push(project);
  }
  params.push(MAX_ROWS_SCANNED);

  const rows = db
    .prepare(
      `SELECT testId, fileId, project, reportId, outcome,
              failure_category AS category, error_signature AS signature,
              failure_details, createdAt
       FROM test_runs
       WHERE ${conditions.join(' AND ')}
       ORDER BY CASE WHEN outcome IN ('failed', 'unexpected') THEN 0 ELSE 1 END ASC,
                createdAt DESC
       LIMIT ?`
    )
    .all(...params);

  const categoryCounts = {};
  const errorMap = new Map();
  const MAX_EXAMPLES = 10;
  let totalFailures = 0;

  for (const row of rows) {
    totalFailures++;
    const cat = row.category;
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;

    const groupKey = row.signature || `category::${cat}`;
    const existing = errorMap.get(groupKey);
    if (existing) {
      existing.count++;
      const exampleKey = makeTestKey(row.testId, row.fileId, row.project);
      if (existing.examples.length < MAX_EXAMPLES && !existing.seenExamples.has(exampleKey)) {
        existing.examples.push({
          testId: row.testId,
          fileId: row.fileId,
          project: row.project,
          reportId: row.reportId,
        });
        existing.seenExamples.add(exampleKey);
      }
      if (existing.message === existing.category && row.failure_details) {
        const msg = extractDisplayMessage(row.failure_details);
        if (msg) {
          existing.message = msg;
          existing.sampleReportId = row.reportId;
          existing.sampleTestId = row.testId;
        }
      }
      continue;
    }

    const message = extractDisplayMessage(row.failure_details) || cat;
    const exampleKey = makeTestKey(row.testId, row.fileId, row.project);
    errorMap.set(groupKey, {
      message,
      category: cat,
      count: 1,
      signature: groupKey,
      sampleReportId: row.reportId,
      sampleTestId: row.testId,
      examples: [
        {
          testId: row.testId,
          fileId: row.fileId,
          project: row.project,
          reportId: row.reportId,
        },
      ],
      seenExamples: new Set([exampleKey]),
    });
  }

  const categories = Object.entries(categoryCounts)
    .map(([category, count]) => ({
      category,
      count,
      percentage: totalFailures > 0 ? (count / totalFailures) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const topErrors = Array.from(errorMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  // Report URLs for examples and samples.
  const reportIds = new Set();
  for (const e of topErrors) {
    if (e.sampleReportId) reportIds.add(e.sampleReportId);
    for (const ex of e.examples) reportIds.add(ex.reportId);
  }
  const urlMap = new Map();
  for (const batch of chunk(Array.from(reportIds), 200)) {
    const placeholders = batch.map(() => '?').join(',');
    const rRows = db
      .prepare(
        `SELECT reportID, reportUrl FROM reports
         WHERE reportID IN (${placeholders}) AND artifactsMissingAt IS NULL`
      )
      .all(...batch);
    for (const r of rRows) urlMap.set(r.reportID, r.reportUrl);
  }

  // Test titles / file paths for affected-test examples.
  const testKeys = new Set();
  for (const e of topErrors) {
    for (const ex of e.examples) testKeys.add(makeTestKey(ex.testId, ex.fileId, ex.project));
  }
  const titleMap = new Map();
  if (testKeys.size > 0) {
    const keys = Array.from(testKeys).map((k) => {
      const [testId, fileId, project] = k.split('::');
      return { testId, fileId, project };
    });
    for (const batch of chunk(keys, 300)) {
      const valuesRows = batch.map(() => '(?, ?, ?)').join(',');
      const params2 = [];
      for (const k of batch) params2.push(k.testId, k.fileId, k.project);
      const tRows = db
        .prepare(
          `SELECT testId, fileId, project, title, filePath FROM tests
           WHERE (testId, fileId, project) IN (VALUES ${valuesRows})`
        )
        .all(...params2);
      for (const row of tRows) {
        titleMap.set(makeTestKey(row.testId, row.fileId, row.project), {
          title: row.title,
          filePath: row.filePath ?? undefined,
        });
      }
    }
  }

  // Open-regression flags (same query as regressionsDb.getOpenForTests,
  // reduced to the key columns the result needs).
  const allTestKeys = Array.from(testKeys).map((k) => {
    const [testId, fileId, project] = k.split('::');
    return { testId, fileId, project };
  });
  const regressedKeys = new Set();
  if (allTestKeys.length > 0) {
    for (const batch of chunk(allTestKeys, 200)) {
      const valuesRows = batch.map(() => '(?, ?, ?)').join(',');
      const params3 = [];
      for (const k of batch) params3.push(k.testId, k.fileId, k.project);
      const rRows = db
        .prepare(
          `WITH keys(testId, fileId, project) AS (VALUES ${valuesRows})
           SELECT r.testId, r.fileId, r.project
           FROM keys k
           JOIN regressions r
             ON r.testId = k.testId AND r.fileId = k.fileId AND r.project = k.project
           JOIN tests t
             ON t.testId = r.testId AND t.fileId = r.fileId AND t.project = r.project
           WHERE r.recoveredAtReportId IS NULL
             AND COALESCE(t.quarantined, 0) = 0
             AND COALESCE(t.latestOutcome, '') != 'skipped'`
        )
        .all(...params3);
      for (const row of rRows) regressedKeys.add(makeTestKey(row.testId, row.fileId, row.project));
    }
  }

  const result = {
    categories,
    totalFailures,
    topErrors: topErrors.map((e) => {
      const affectedTests = e.examples.map((ex) => {
        const t = titleMap.get(makeTestKey(ex.testId, ex.fileId, ex.project));
        return {
          testId: ex.testId,
          title: t?.title ?? ex.testId,
          filePath: t?.filePath,
          project: ex.project,
          reportId: ex.reportId,
          reportUrl: urlMap.get(ex.reportId),
          isRegressed: regressedKeys.has(makeTestKey(ex.testId, ex.fileId, ex.project)),
        };
      });
      return {
        message: e.message,
        category: e.category,
        count: e.count,
        signature: e.signature,
        sampleReportId: e.sampleReportId,
        sampleTestId: e.sampleTestId,
        sampleReportUrl: e.sampleReportId ? urlMap.get(e.sampleReportId) : undefined,
        regressedTestCount: affectedTests.filter((t) => t.isRegressed).length,
        affectedTests,
      };
    }),
  };

  db.close();

  if (!parentPort) {
    console.error('[failure-aggregate-worker] no parent port; nothing to report to');
    process.exit(1);
  }
  parentPort.postMessage(result);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (parentPort) {
    parentPort.postMessage({ __workerError: message });
  } else {
    console.error('[failure-aggregate-worker]', message);
  }
  process.exit(1);
}

import type { ReportAnalysisStructured } from '@playwright-reports/shared';
import type Database from 'better-sqlite3';
import { getDatabase } from './db.js';
import { decodeFailureDetails } from './failureDetailsCodec.js';
import { singletonOf } from './singleton.js';
import { buildWhere, chunk, parseJsonColumn } from './utils.js';

export interface FailureSummaryRow {
  reportId: string;
  project: string;
  totalFailures: number;
  categories: Record<string, number>;
  llmSummary: string | null;
  /** Parsed structured analysis. Null when the worker couldn't recover
   *  structure (text-only LLM response that the parser couldn't coerce). */
  llmSummaryStructured: ReportAnalysisStructured | null;
  llmModel: string | null;
  createdAt: string;
  updatedAt: string | null;
}

interface FailureSummaryDbRow {
  reportId: string;
  project: string;
  totalFailures: number;
  categories: string;
  llmSummary: string | null;
  llmSummaryStructured: string | null;
  llmModel: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export class FailureSummaryDatabase {
  private readonly db = getDatabase();

  private readonly upsertStmt: Database.Statement<[string, string, number, string, string]>;
  private readonly getStmt: Database.Statement<[string]>;
  private readonly updateLlmSummaryStmt: Database.Statement<
    [string, string | null, string | null, string, string]
  >;
  private readonly deleteStmt: Database.Statement<[string]>;

  constructor() {
    this.upsertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO report_failure_summaries (reportId, project, totalFailures, categories, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `);

    this.getStmt = this.db.prepare(`
      SELECT * FROM report_failure_summaries WHERE reportId = ?
    `);

    this.updateLlmSummaryStmt = this.db.prepare(`
      UPDATE report_failure_summaries
      SET llmSummary = ?, llmSummaryStructured = ?, llmModel = ?, updatedAt = ?
      WHERE reportId = ?
    `);

    this.deleteStmt = this.db.prepare(`
      DELETE FROM report_failure_summaries WHERE reportId = ?
    `);
  }

  private parseRow(row: FailureSummaryDbRow): FailureSummaryRow {
    return {
      reportId: row.reportId,
      project: row.project,
      totalFailures: row.totalFailures,
      categories: parseJsonColumn<Record<string, number>>(row.categories, {}),
      llmSummary: row.llmSummary,
      llmSummaryStructured: parseJsonColumn<ReportAnalysisStructured | null>(
        row.llmSummaryStructured,
        null
      ),
      llmModel: row.llmModel,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  public upsertSummary(
    reportId: string,
    project: string,
    totalFailures: number,
    categories: Record<string, number>
  ): void {
    const now = new Date().toISOString();
    this.upsertStmt.run(reportId, project, totalFailures, JSON.stringify(categories), now);
  }

  public getSummary(reportId: string): FailureSummaryRow | null {
    const row = this.getStmt.get(reportId) as FailureSummaryDbRow | undefined;
    if (!row) return null;
    return this.parseRow(row);
  }

  public updateLlmSummary(
    reportId: string,
    llmSummary: string,
    structured: ReportAnalysisStructured | null,
    llmModel?: string | null
  ): void {
    const now = new Date().toISOString();
    this.updateLlmSummaryStmt.run(
      llmSummary,
      structured ? JSON.stringify(structured) : null,
      llmModel ?? null,
      now,
      reportId
    );
  }

  /**
   * Get the latest N reports that had failures.
   * If `opts.from`/`opts.to` are provided, the window is bounded by those ISO timestamps.
   * Otherwise falls back to the last `days` days (default 30).
   */
  public getSummariesByProject(
    project?: string,
    limit = 10,
    opts?: { from?: string; to?: string; days?: number }
  ): FailureSummaryRow[] {
    const hasProject = project && project !== 'all';
    const defaultCutoff =
      !opts?.from && !opts?.to
        ? (() => {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - (opts?.days ?? 30));
            return cutoff.toISOString();
          })()
        : null;

    const { sql: whereSql, params } = buildWhere([
      { sql: 'totalFailures > 0', params: [] },
      hasProject ? { sql: 'project = ?', params: [project] } : null,
      opts?.from ? { sql: 'createdAt >= ?', params: [opts.from] } : null,
      opts?.to ? { sql: 'createdAt < ?', params: [opts.to] } : null,
      defaultCutoff ? { sql: 'createdAt >= ?', params: [defaultCutoff] } : null,
    ]);

    const sql = `SELECT * FROM report_failure_summaries ${whereSql} ORDER BY createdAt DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params, limit) as FailureSummaryDbRow[];
    return rows.map((row) => this.parseRow(row));
  }

  public deleteSummary(reportId: string): void {
    this.deleteStmt.run(reportId);
  }

  public deleteSummariesByReportIds(reportIds: string[]): void {
    if (reportIds.length === 0) return;
    const placeholders = reportIds.map(() => '?').join(',');
    this.db
      .prepare(`DELETE FROM report_failure_summaries WHERE reportId IN (${placeholders})`)
      .run(...reportIds);
  }

  /**
   * Aggregate failure categories and top error groups directly from `test_runs`.
   * Gives us:
   *   - fresh categories (reflects post-recategorize labels)
   *   - real sample error messages
   *   - reportId + testId per top group, so the UI can deep-link to the
   *     specific failed test inside the served Playwright report.
   */
  public getAggregatedCategories(
    project?: string,
    limit = 10,
    opts?: { from?: string; to?: string }
  ): {
    categories: Array<{ category: string; count: number; percentage: number }>;
    totalFailures: number;
    topErrors: Array<{
      message: string;
      category: string;
      count: number;
      signature: string;
      sampleReportId?: string;
      sampleReportUrl?: string;
      sampleTestId?: string;
      affectedTests?: Array<{
        testId: string;
        title: string;
        filePath?: string;
        project: string;
        reportId: string;
        reportUrl?: string;
      }>;
    }>;
  } {
    const { sql: whereSql, params } = buildWhere([
      { sql: 'failure_category IS NOT NULL', params: [] },
      project && project !== 'all' ? { sql: 'project = ?', params: [project] } : null,
      opts?.from ? { sql: 'createdAt >= ?', params: [opts.from] } : null,
      opts?.to ? { sql: 'createdAt < ?', params: [opts.to] } : null,
    ]);

    // Cap the working set so a wide window on a busy project can't materialize
    // an unbounded result list into memory. The aggregate is still correct for
    // the most recent failures; categories beyond the cap are dropped — which
    // matches what the UI shows anyway (it slices to `limit` top groups).
    const MAX_ROWS_SCANNED = 20_000;
    const sql = `
      SELECT testId, fileId, project, reportId, failure_category as category,
             error_signature as signature, error_signature_global as signatureGlobal,
             failure_details, createdAt
      FROM test_runs
      ${whereSql}
      ORDER BY createdAt DESC
      LIMIT ${MAX_ROWS_SCANNED}
    `;
    const rows = this.db.prepare(sql).all(...params) as Array<{
      testId: string;
      fileId: string;
      project: string;
      reportId: string;
      category: string;
      signature: string | null;
      signatureGlobal: string | null;
      failure_details: Buffer | string | null;
      createdAt: string;
    }>;

    const categoryCounts: Record<string, number> = {};
    const errorMap = new Map<
      string,
      {
        message: string;
        category: string;
        count: number;
        signature: string;
        sampleReportId?: string;
        sampleTestId?: string;
        // Up to 10 distinct (testId, fileId, project, reportId) examples for this error
        // signature — populated in iteration order (newest first by createdAt DESC sort).
        examples: Array<{ testId: string; fileId: string; project: string; reportId: string }>;
        seenExamples: Set<string>;
      }
    >();

    const MAX_EXAMPLES = 10;
    let totalFailures = 0;
    for (const row of rows) {
      totalFailures++;
      categoryCounts[row.category] = (categoryCounts[row.category] ?? 0) + 1;

      const groupKey = row.signatureGlobal || row.signature || `category::${row.category}`;
      const existing = errorMap.get(groupKey);
      if (existing) {
        existing.count++;
        const exampleKey = `${row.testId}::${row.fileId}::${row.project}`;
        if (existing.examples.length < MAX_EXAMPLES && !existing.seenExamples.has(exampleKey)) {
          existing.examples.push({
            testId: row.testId,
            fileId: row.fileId,
            project: row.project,
            reportId: row.reportId,
          });
          existing.seenExamples.add(exampleKey);
        }
        // Prefer the most-recent sample with a non-empty message.
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

      const message = extractDisplayMessage(row.failure_details) || row.category;
      const exampleKey = `${row.testId}::${row.fileId}::${row.project}`;
      errorMap.set(groupKey, {
        message,
        category: row.category,
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

    // Resolve reportUrl for every reportId referenced (sample + examples) in one batched query.
    const reportIds = new Set<string>();
    for (const e of topErrors) {
      if (e.sampleReportId) reportIds.add(e.sampleReportId);
      for (const ex of e.examples) reportIds.add(ex.reportId);
    }
    let urlMap = new Map<string, string>();
    if (reportIds.size > 0) {
      const ids = Array.from(reportIds);
      const placeholders = ids.map(() => '?').join(',');
      const reportRows = this.db
        .prepare(`SELECT reportID, reportUrl FROM reports WHERE reportID IN (${placeholders})`)
        .all(...ids) as Array<{ reportID: string; reportUrl: string }>;
      urlMap = new Map(reportRows.map((r) => [r.reportID, r.reportUrl]));
    }

    // Resolve test titles + filePaths for every distinct (testId, fileId, project) referenced.
    type TestKey = string;
    const makeTestKey = (testId: string, fileId: string, project: string): TestKey =>
      `${testId}::${fileId}::${project}`;
    const testKeys = new Set<TestKey>();
    for (const e of topErrors) {
      for (const ex of e.examples) testKeys.add(makeTestKey(ex.testId, ex.fileId, ex.project));
    }
    const titleMap = new Map<TestKey, { title: string; filePath?: string }>();
    if (testKeys.size > 0) {
      const keys = Array.from(testKeys).map((k) => {
        const [testId, fileId, project] = k.split('::');
        return { testId, fileId, project };
      });
      // 300 keys × 3 params = 900 placeholders, safely under SQLite's 999 cap.
      for (const batch of chunk(keys, 300)) {
        const valuesSql = batch.map(() => '(?, ?, ?)').join(', ');
        const params = batch.flatMap((k) => [k.testId, k.fileId, k.project]);
        const rows = this.db
          .prepare(
            `SELECT testId, fileId, project, title, filePath
             FROM tests
             WHERE (testId, fileId, project) IN (VALUES ${valuesSql})`
          )
          .all(...params) as Array<{
          testId: string;
          fileId: string;
          project: string;
          title: string;
          filePath: string | null;
        }>;
        for (const row of rows) {
          titleMap.set(makeTestKey(row.testId, row.fileId, row.project), {
            title: row.title,
            filePath: row.filePath ?? undefined,
          });
        }
      }
    }

    return {
      categories,
      totalFailures,
      topErrors: topErrors.map((e) => ({
        message: e.message,
        category: e.category,
        count: e.count,
        signature: e.signature,
        sampleReportId: e.sampleReportId,
        sampleTestId: e.sampleTestId,
        sampleReportUrl: e.sampleReportId ? urlMap.get(e.sampleReportId) : undefined,
        affectedTests: e.examples.map((ex) => {
          const t = titleMap.get(makeTestKey(ex.testId, ex.fileId, ex.project));
          return {
            testId: ex.testId,
            title: t?.title ?? ex.testId,
            filePath: t?.filePath,
            project: ex.project,
            reportId: ex.reportId,
            reportUrl: urlMap.get(ex.reportId),
          };
        }),
      })),
    };
  }

  public deleteAll(): void {
    this.db.prepare('DELETE FROM report_failure_summaries').run();
  }
}

export const failureSummaryDb = singletonOf('failureSummary', () => new FailureSummaryDatabase());

const PAGE_CONTEXT_HEADER = '\n\n# Page Context';

/**
 * Pull the human-readable error text out of a stored `failure_details` value.
 * Accepts the raw column (gzip BLOB or plaintext) and strips the
 * appended Page Context (DOM snapshot) — useful for LLM analysis but noise
 * for the dashboard widget.
 */
function extractDisplayMessage(failureDetailsRaw: Buffer | string | null): string {
  const json = decodeFailureDetails(failureDetailsRaw);
  if (!json) return '';
  try {
    const parsed = JSON.parse(json) as { message?: string };
    let msg = String(parsed.message ?? '');
    const headerIdx = msg.indexOf(PAGE_CONTEXT_HEADER);
    if (headerIdx > 0) msg = msg.substring(0, headerIdx);
    return msg.trim();
  } catch {
    return '';
  }
}

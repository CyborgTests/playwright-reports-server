import type Database from 'better-sqlite3';
import { getDatabase } from './db.js';

const initiatedFailureSummaryDb = Symbol.for('playwright.reports.db.failureSummary');
const instance = globalThis as typeof globalThis & {
  [initiatedFailureSummaryDb]?: FailureSummaryDatabase;
};

export interface ErrorGroup {
  pattern: string;
  count: number;
  category: string;
  testIds: string[];
}

export interface FailureSummaryRow {
  reportId: string;
  project: string;
  totalFailures: number;
  categories: Record<string, number>;
  errorGroups: ErrorGroup[];
  llmSummary: string | null;
  llmModel: string | null;
  createdAt: string;
  updatedAt: string | null;
}

interface FailureSummaryDbRow {
  reportId: string;
  project: string;
  totalFailures: number;
  categories: string;
  errorGroups: string;
  llmSummary: string | null;
  llmModel: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export class FailureSummaryDatabase {
  private readonly db = getDatabase();

  private readonly upsertStmt: Database.Statement<[string, string, number, string, string, string]>;
  private readonly getStmt: Database.Statement<[string]>;
  private readonly updateLlmSummaryStmt: Database.Statement<
    [string, string | null, string, string]
  >;
  private readonly deleteStmt: Database.Statement<[string]>;

  private constructor() {
    this.upsertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO report_failure_summaries (reportId, project, totalFailures, categories, errorGroups, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.getStmt = this.db.prepare(`
      SELECT * FROM report_failure_summaries WHERE reportId = ?
    `);

    this.updateLlmSummaryStmt = this.db.prepare(`
      UPDATE report_failure_summaries SET llmSummary = ?, llmModel = ?, updatedAt = ? WHERE reportId = ?
    `);

    this.deleteStmt = this.db.prepare(`
      DELETE FROM report_failure_summaries WHERE reportId = ?
    `);
  }

  public static getInstance(): FailureSummaryDatabase {
    instance[initiatedFailureSummaryDb] ??= new FailureSummaryDatabase();
    return instance[initiatedFailureSummaryDb];
  }

  private parseRow(row: FailureSummaryDbRow): FailureSummaryRow {
    return {
      ...row,
      categories: JSON.parse(row.categories) as Record<string, number>,
      errorGroups: JSON.parse(row.errorGroups) as ErrorGroup[],
    };
  }

  public upsertSummary(
    reportId: string,
    project: string,
    totalFailures: number,
    categories: Record<string, number>,
    errorGroups: ErrorGroup[]
  ): void {
    const now = new Date().toISOString();
    this.upsertStmt.run(
      reportId,
      project,
      totalFailures,
      JSON.stringify(categories),
      JSON.stringify(errorGroups),
      now
    );
  }

  public getSummary(reportId: string): FailureSummaryRow | null {
    const row = this.getStmt.get(reportId) as FailureSummaryDbRow | undefined;
    if (!row) return null;
    return this.parseRow(row);
  }

  public updateLlmSummary(reportId: string, llmSummary: string, llmModel?: string | null): void {
    const now = new Date().toISOString();
    this.updateLlmSummaryStmt.run(llmSummary, llmModel ?? null, now, reportId);
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
    const conditions: string[] = ['totalFailures > 0'];
    const params: Array<string | number> = [];

    const hasProject = project && project !== 'all';
    if (hasProject) {
      conditions.push('project = ?');
      params.push(project);
    }

    if (opts?.from) {
      conditions.push('datetime(createdAt) >= datetime(?)');
      params.push(opts.from);
    }
    if (opts?.to) {
      conditions.push('datetime(createdAt) < datetime(?)');
      params.push(opts.to);
    }

    if (!opts?.from && !opts?.to) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - (opts?.days ?? 30));
      conditions.push('datetime(createdAt) >= datetime(?)');
      params.push(cutoff.toISOString());
    }

    params.push(limit);
    const sql = `SELECT * FROM report_failure_summaries WHERE ${conditions.join(' AND ')} ORDER BY createdAt DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params) as FailureSummaryDbRow[];
    return rows.map((row) => this.parseRow(row));
  }

  public deleteSummary(reportId: string): void {
    this.deleteStmt.run(reportId);
  }

  /**
   * Aggregate failure categories and top error groups directly from `test_runs`.
   *
   * Previously this read from the cached `report_failure_summaries.errorGroups`,
   * but those rows frequently store empty `pattern` strings (the cache was
   * populated when `failure_details.message` was empty), so the dashboard fell
   * back to showing just the category name in the Most Common Failures widget.
   * Querying `test_runs` directly gives us:
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
    const conditions: string[] = ['failure_category IS NOT NULL'];
    const params: string[] = [];
    if (project && project !== 'all') {
      conditions.push('project = ?');
      params.push(project);
    }
    if (opts?.from) {
      conditions.push('datetime(createdAt) >= datetime(?)');
      params.push(opts.from);
    }
    if (opts?.to) {
      conditions.push('datetime(createdAt) < datetime(?)');
      params.push(opts.to);
    }

    const sql = `
      SELECT testId, fileId, project, reportId, failure_category as category,
             error_signature as signature, failure_details, createdAt
      FROM test_runs
      WHERE ${conditions.join(' AND ')}
      ORDER BY createdAt DESC
    `;
    const rows = this.db.prepare(sql).all(...params) as Array<{
      testId: string;
      fileId: string;
      project: string;
      reportId: string;
      category: string;
      signature: string | null;
      failure_details: string | null;
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

      const groupKey = row.signature || `category::${row.category}`;
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
      const stmt = this.db.prepare(
        'SELECT testId, fileId, project, title, filePath FROM tests WHERE testId = ? AND fileId = ? AND project = ?'
      );
      for (const key of testKeys) {
        const [testId, fileId, project] = key.split('::');
        const row = stmt.get(testId, fileId, project) as
          | {
              testId: string;
              fileId: string;
              project: string;
              title: string;
              filePath: string | null;
            }
          | undefined;
        if (row) {
          titleMap.set(key, { title: row.title, filePath: row.filePath ?? undefined });
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
}

export const failureSummaryDb = FailureSummaryDatabase.getInstance();

const PAGE_CONTEXT_HEADER = '\n\n# Page Context';

/**
 * Pull the human-readable error text out of a stored `failure_details` JSON blob.
 * Strips the appended Page Context (DOM snapshot) — that's useful for LLM analysis
 * but noise for the dashboard widget.
 */
function extractDisplayMessage(failureDetailsJson: string | null): string {
  if (!failureDetailsJson) return '';
  try {
    const parsed = JSON.parse(failureDetailsJson) as { message?: string };
    let msg = String(parsed.message ?? '');
    const headerIdx = msg.indexOf(PAGE_CONTEXT_HEADER);
    if (headerIdx > 0) msg = msg.substring(0, headerIdx);
    return msg.trim();
  } catch {
    return '';
  }
}

import { randomUUID as uuid } from 'node:crypto';
import type { LlmTaskStatus, LlmTaskType } from '@playwright-reports/shared';
import type Database from 'better-sqlite3';
import { llmTaskEvents } from '../llmTaskEvents.js';
import { getDatabase } from './db.js';

import { singletonOf } from './singleton.js';
import { buildWhere, paginationClause } from './utils.js';

export type { LlmTaskStatus, LlmTaskType } from '@playwright-reports/shared';

export interface LlmTaskRow {
  id: string;
  type: LlmTaskType;
  status: LlmTaskStatus;
  priority: number;
  reportId: string | null;
  testId: string | null;
  fileId: string | null;
  project: string | null;
  prompt: string | null;
  result: string | null;
  category: string | null;
  model: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  retryCount: number;
  maxRetries: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  isRetry: number;
  reportIds: string | null;
  baseUrl: string | null;
}

export interface LlmTaskRowEnriched extends LlmTaskRow {
  reportDisplayNumber: number | null;
  reportTitle: string | null;
  testTitle: string | null;
}

export interface LlmTaskUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export class LlmTasksDatabase {
  private readonly db = getDatabase();

  private readonly insertTaskStmt: Database.Statement<
    [
      string,
      string,
      number,
      string | null,
      string | null,
      string | null,
      string | null,
      string,
      number,
      string | null,
    ]
  >;
  private readonly selectQueuedStmt: Database.Statement<[number]>;
  private readonly claimTaskStmt: Database.Statement<[string, string]>;
  private readonly completeTaskStmt: Database.Statement<
    [
      string,
      string,
      string | null,
      string | null,
      string | null,
      number | null,
      number | null,
      number | null,
      string,
    ]
  >;
  private readonly failTaskStmt: Database.Statement<[string, string | null, string]>;
  private readonly requeueTaskStmt: Database.Statement<[string | null, string]>;
  private readonly cancelTaskStmt: Database.Statement<[string]>;
  private readonly retryTaskStmt: Database.Statement<[string]>;
  private readonly clearQueueStmt: Database.Statement<[]>;
  private readonly getStatsStmt: Database.Statement<[]>;
  private readonly getByReportStmt: Database.Statement<[string]>;
  private readonly getTestAnalysisTasksForReportStmt: Database.Statement<[string]>;
  private readonly areAllTestTasksCompleteStmt: Database.Statement<[string]>;
  private readonly deleteByReportStmt: Database.Statement<[string]>;

  constructor() {
    this.insertTaskStmt = this.db.prepare(`
      INSERT INTO llm_tasks (id, type, status, priority, reportId, testId, fileId, project, createdAt, isRetry, reportIds)
      VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Selection rules:
    //   - test_analysis is always claimable.
    //   - report_summary for report R becomes claimable once no
    //     test_analysis for R is still queued or processing — the summary
    //     needs every per-test analysis written before it can roll up.
    //   - project_summary for project P becomes claimable once no
    //     test_analysis or report_summary is pending for any report in P.
    //     A project_summary keyed 'all' waits on report-bound work across
    //     every project. This stops the summary from running on a stale
    //     snapshot while per-test analyses are still landing.
    //
    // Ordering by (priority DESC, createdAt ASC) means: when reports A and
    // B are both queued, A's earlier-arrived tests fill the parallel slots
    // first; once A has fewer queued tests than free slots, B's tests
    // backfill rather than letting workers idle. Manual project_summary
    // sits above test work via its high priority and runs as soon as its
    // project is idle; auto project_summary sits at the tail.
    this.selectQueuedStmt = this.db.prepare(`
      WITH active_test_analysis_reports AS (
        SELECT DISTINCT reportId FROM llm_tasks
        WHERE type = 'test_analysis'
          AND status IN ('queued', 'processing')
          AND reportId IS NOT NULL
      ),
      active_report_or_test_projects AS (
        SELECT DISTINCT project FROM llm_tasks
        WHERE type IN ('test_analysis', 'report_summary')
          AND status IN ('queued', 'processing')
      )
      SELECT t.* FROM llm_tasks t
      WHERE t.status = 'queued'
        AND (
          t.type = 'test_analysis'
          OR (
            t.type = 'report_summary'
            AND (
              t.reportId IS NULL
              OR t.reportId NOT IN (SELECT reportId FROM active_test_analysis_reports)
            )
          )
          OR (
            t.type = 'project_summary'
            AND NOT EXISTS (
              SELECT 1 FROM active_report_or_test_projects atp
              WHERE t.project = 'all' OR atp.project = t.project
            )
          )
        )
      ORDER BY t.priority DESC, t.createdAt ASC
      LIMIT ?
    `);

    this.claimTaskStmt = this.db.prepare(`
      UPDATE llm_tasks
      SET status = 'processing', startedAt = ?
      WHERE id = ?
    `);

    this.completeTaskStmt = this.db.prepare(`
      UPDATE llm_tasks
      SET status = 'completed', completedAt = ?, result = ?, category = ?, model = ?, baseUrl = ?,
          inputTokens = ?, outputTokens = ?, totalTokens = ?
      WHERE id = ?
    `);

    // completedAt is written as a JS ISO-8601 string (UTC, with 'T'/'Z'). Using
    // CURRENT_TIMESTAMP would emit SQLite's 'YYYY-MM-DD HH:MM:SS' format which V8
    // parses as local time, producing negative durations for users east of UTC.
    this.failTaskStmt = this.db.prepare(`
      UPDATE llm_tasks
      SET status = 'failed', completedAt = ?, error = ?
      WHERE id = ?
    `);

    this.requeueTaskStmt = this.db.prepare(`
      UPDATE llm_tasks
      SET status = 'queued', retryCount = retryCount + 1, error = ?
      WHERE id = ?
    `);

    this.cancelTaskStmt = this.db.prepare(`
      UPDATE llm_tasks
      SET status = 'cancelled'
      WHERE id = ? AND status = 'queued'
    `);

    this.retryTaskStmt = this.db.prepare(`
      UPDATE llm_tasks
      SET status = 'queued', retryCount = 0, error = NULL, startedAt = NULL, completedAt = NULL,
          isRetry = 1
      WHERE id = ? AND status = 'failed'
    `);

    this.clearQueueStmt = this.db.prepare(`
      DELETE FROM llm_tasks WHERE status IN ('queued', 'cancelled')
    `);

    this.getStatsStmt = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM llm_tasks GROUP BY status
    `);

    this.getByReportStmt = this.db.prepare(`
      SELECT * FROM llm_tasks WHERE reportId = ?
    `);

    this.getTestAnalysisTasksForReportStmt = this.db.prepare(`
      SELECT * FROM llm_tasks WHERE reportId = ? AND type = 'test_analysis'
    `);

    this.areAllTestTasksCompleteStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM llm_tasks
      WHERE reportId = ? AND type = 'test_analysis' AND status NOT IN ('completed', 'cancelled', 'failed')
    `);

    this.deleteByReportStmt = this.db.prepare(`
      DELETE FROM llm_tasks WHERE reportId = ?
    `);
  }

  public createTask(
    type: LlmTaskType,
    opts: {
      reportId?: string;
      testId?: string;
      fileId?: string;
      project?: string;
      priority?: number;
      isRetry?: boolean;
      reportIds?: string[];
    } = {}
  ): LlmTaskRow {
    const id = uuid();
    const now = new Date().toISOString();
    const priority = opts.priority ?? 0;
    const isRetry = opts.isRetry ? 1 : 0;
    const reportIdsJson =
      opts.reportIds && opts.reportIds.length > 0 ? JSON.stringify(opts.reportIds) : null;

    this.insertTaskStmt.run(
      id,
      type,
      priority,
      opts.reportId ?? null,
      opts.testId ?? null,
      opts.fileId ?? null,
      opts.project ?? null,
      now,
      isRetry,
      reportIdsJson
    );

    return {
      id,
      type,
      status: 'queued',
      priority,
      reportId: opts.reportId ?? null,
      testId: opts.testId ?? null,
      fileId: opts.fileId ?? null,
      project: opts.project ?? null,
      prompt: null,
      result: null,
      category: null,
      model: null,
      error: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      retryCount: 0,
      maxRetries: 2,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      isRetry,
      reportIds: reportIdsJson,
      baseUrl: null,
    };
  }

  public markAsRetry(id: string): void {
    this.db.prepare(`UPDATE llm_tasks SET isRetry = 1 WHERE id = ? AND status = 'queued'`).run(id);
  }

  public updateReportIds(id: string, reportIds: string[] | null): void {
    const json = reportIds && reportIds.length > 0 ? JSON.stringify(reportIds) : null;
    this.db
      .prepare(
        `UPDATE llm_tasks SET reportIds = ? WHERE id = ? AND status IN ('queued','processing')`
      )
      .run(json, id);
  }

  public claimNext(count: number): LlmTaskRow[] {
    const hasQueued = this.db
      .prepare("SELECT 1 FROM llm_tasks WHERE status = 'queued' LIMIT 1")
      .get() as { 1: number } | undefined;
    if (!hasQueued) return [];

    const transaction = this.db.transaction(() => {
      const rows = this.selectQueuedStmt.all(count) as LlmTaskRow[];
      const now = new Date().toISOString();

      for (const row of rows) {
        this.claimTaskStmt.run(now, row.id);
        row.status = 'processing';
        row.startedAt = now;
      }

      return rows;
    });

    const claimed = transaction();
    for (const row of claimed) {
      this.fireUpdateEvent(row.id);
    }
    return claimed;
  }

  public complete(
    id: string,
    result: string,
    category?: string | null,
    model?: string | null,
    extras?: { usage?: LlmTaskUsage; baseUrl?: string | null }
  ): void {
    const now = new Date().toISOString();
    const usage = extras?.usage;
    this.completeTaskStmt.run(
      now,
      result,
      category ?? null,
      model ?? null,
      extras?.baseUrl ?? null,
      usage?.inputTokens ?? null,
      usage?.outputTokens ?? null,
      usage?.totalTokens ?? null,
      id
    );
    this.fireUpdateEvent(id);
  }

  public fail(id: string, error: string): void {
    const task = this.db
      .prepare('SELECT retryCount, maxRetries FROM llm_tasks WHERE id = ?')
      .get(id) as { retryCount: number; maxRetries: number } | undefined;

    if (!task) return;

    if (task.retryCount < task.maxRetries) {
      this.requeueTaskStmt.run(error, id);
    } else {
      const now = new Date().toISOString();
      this.failTaskStmt.run(now, error, id);
    }
    this.fireUpdateEvent(id);
  }

  /** Look up the post-update row and broadcast it to event subscribers. */
  private fireUpdateEvent(id: string): void {
    const row = this.db.prepare('SELECT * FROM llm_tasks WHERE id = ?').get(id) as
      | LlmTaskRow
      | undefined;
    if (row) llmTaskEvents.emitTaskUpdate(row);
  }

  public cancel(id: string): void {
    this.cancelTaskStmt.run(id);
    this.fireUpdateEvent(id);
  }

  /** Fail every task left in `processing` — called once at boot. A task in
   *  `processing` after a process restart is necessarily orphaned: the worker
   *  that claimed it (queue or SSE route) is gone and won't return. We don't
   *  know if the LLM call actually completed before the crash, so failing is
   *  safer than requeuing (which could double-bill and produce duplicate
   *  analyses). The user can manually retry from the queue page. */
  public failStaleProcessing(): number {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE llm_tasks
         SET status = 'failed', completedAt = ?, error = ?
         WHERE status = 'processing'`
      )
      .run(now, 'Server restarted while task was processing');
    return result.changes;
  }

  public retry(id: string): void {
    this.retryTaskStmt.run(id);
    this.fireUpdateEvent(id);
  }

  public bulkDelete(ids: string[]): void {
    if (ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`DELETE FROM llm_tasks WHERE id IN (${placeholders})`).run(...ids);
  }

  public clearQueue(): void {
    this.clearQueueStmt.run();
  }

  public getStats(): {
    queued: number;
    processing: number;
    completed: number;
    failed: number;
    cancelled: number;
  } {
    const rows = this.getStatsStmt.all() as Array<{ status: string; count: number }>;
    const stats = { queued: 0, processing: 0, completed: 0, failed: 0, cancelled: 0 };

    for (const row of rows) {
      if (row.status in stats) {
        stats[row.status as keyof typeof stats] = row.count;
      }
    }

    return stats;
  }

  /**
   * Count in-flight tasks (queued or processing) for a single report — any task type.
   * Used by the report detail page to disable the "Summarize Failures" button while
   * an analysis is already running.
   */
  public getInflightCountForReport(reportId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM llm_tasks
         WHERE reportId = ? AND status IN ('queued','processing')`
      )
      .get(reportId) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /**
   * Count in-flight project_summary tasks for a project. Drives the dashboard's
   * "Analysis ongoing" state and refetch polling on the cached summary endpoint.
   */
  public getInflightCountForProject(project: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as count FROM llm_tasks
         WHERE type = 'project_summary'
           AND project = ?
           AND status IN ('queued','processing')`
      )
      .get(project) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  public getTasksPaginated(opts: {
    status?: LlmTaskStatus;
    type?: LlmTaskType;
    reportId?: string;
    limit: number;
    offset: number;
  }): { data: LlmTaskRowEnriched[]; total: number } {
    const { sql: whereSql, params: whereParams } = buildWhere([
      opts.status ? { sql: 't.status = ?', params: [opts.status] } : null,
      opts.type ? { sql: 't.type = ?', params: [opts.type] } : null,
      opts.reportId ? { sql: 't.reportId = ?', params: [opts.reportId] } : null,
    ]);

    const countResult = this.db
      .prepare(`SELECT COUNT(*) as total FROM llm_tasks t ${whereSql}`.trim())
      .get(...whereParams) as { total: number };

    const { sql: pageSql, params: pageParams } = paginationClause({
      limit: opts.limit,
      offset: opts.offset,
    });

    const data = this.db
      .prepare(
        `SELECT t.*,
                r.displayNumber AS reportDisplayNumber,
                r.title AS reportTitle,
                te.title AS testTitle
         FROM llm_tasks t
         LEFT JOIN reports r ON r.reportID = t.reportId
         LEFT JOIN tests te ON te.testId = t.testId
                            AND te.fileId = t.fileId
                            AND te.project = t.project
         ${whereSql}
         ORDER BY t.createdAt DESC
         ${pageSql}`
      )
      .all(...whereParams, ...pageParams) as LlmTaskRowEnriched[];

    return { data, total: countResult.total };
  }

  public getByReport(reportId: string): LlmTaskRow[] {
    return this.getByReportStmt.all(reportId) as LlmTaskRow[];
  }

  public getTestAnalysisTasksForReport(reportId: string): LlmTaskRow[] {
    return this.getTestAnalysisTasksForReportStmt.all(reportId) as LlmTaskRow[];
  }

  public areAllTestTasksComplete(reportId: string): boolean {
    const result = this.areAllTestTasksCompleteStmt.get(reportId) as { count: number };
    return result.count === 0;
  }

  public deleteByReport(reportId: string): void {
    this.deleteByReportStmt.run(reportId);
  }

  public deleteByReportIds(reportIds: string[]): void {
    if (reportIds.length === 0) return;
    const placeholders = reportIds.map(() => '?').join(',');
    this.db.prepare(`DELETE FROM llm_tasks WHERE reportId IN (${placeholders})`).run(...reportIds);
  }

  public pruneCompletedOlderThan(cutoffISO: string): number {
    return this.db
      .prepare(
        `DELETE FROM llm_tasks WHERE status = 'completed' AND completedAt IS NOT NULL AND completedAt < ?`
      )
      .run(cutoffISO).changes;
  }

  public updatePrompt(id: string, prompt: string, estimatedInputTokens: number): void {
    this.db
      .prepare('UPDATE llm_tasks SET prompt = ?, inputTokens = ? WHERE id = ?')
      .run(prompt, estimatedInputTokens, id);
    this.fireUpdateEvent(id);
  }

  /** Direct lookup by id. Returns null when the id doesn't exist. */
  public getById(id: string): LlmTaskRow | null {
    const row = this.db.prepare('SELECT * FROM llm_tasks WHERE id = ?').get(id) as
      | LlmTaskRow
      | undefined;
    return row ?? null;
  }

  /**
   * Latest completed `test_analysis` task for (testId, reportId). Backing the
   * "Copy prompt" button in the in-report widget and the `pwrs-cli test
   * analysis-prompt` command — both render the exact text we sent on the most
   * recent run. Returns null when no completed task exists.
   */
  public getLatestCompletedTestAnalysisTask(testId: string, reportId: string): LlmTaskRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM llm_tasks
         WHERE type = 'test_analysis'
           AND status = 'completed'
           AND testId = ?
           AND reportId = ?
         ORDER BY COALESCE(completedAt, createdAt) DESC
         LIMIT 1`
      )
      .get(testId, reportId) as LlmTaskRow | undefined;
    return row ?? null;
  }

  public requeueWithRetryIncrement(id: string): void {
    this.db
      .prepare(
        "UPDATE llm_tasks SET status = 'queued', startedAt = NULL, retryCount = retryCount + 1 WHERE id = ?"
      )
      .run(id);
  }

  public findInflightTestAnalysis(
    testId: string,
    reportId: string | null | undefined,
    options: { retryOnly?: boolean } = {}
  ): { id: string; status: string } | null {
    const retrySql = options.retryOnly ? ' AND isRetry = 1' : '';
    if (reportId) {
      const row = this.db
        .prepare(
          `SELECT id, status FROM llm_tasks
           WHERE type = 'test_analysis'
             AND testId = ? AND reportId = ?
             AND status IN ('queued','processing')${retrySql}
           ORDER BY createdAt DESC
           LIMIT 1`
        )
        .get(testId, reportId) as { id: string; status: string } | undefined;
      return row ?? null;
    }
    const row = this.db
      .prepare(
        `SELECT id, status FROM llm_tasks
         WHERE type = 'test_analysis'
           AND testId = ?
           AND status IN ('queued','processing')${retrySql}
         ORDER BY createdAt DESC
         LIMIT 1`
      )
      .get(testId) as { id: string; status: string } | undefined;
    return row ?? null;
  }

  public getLatestCompletedTestAnalysisResult(
    testId: string,
    reportId: string | null | undefined
  ): { analysis: string; model: string | null; category: string | null } | null {
    if (reportId) {
      const row = this.db
        .prepare(
          `SELECT result AS analysis, model, category FROM llm_tasks
           WHERE testId = ? AND reportId = ? AND status = 'completed' AND result IS NOT NULL
           ORDER BY completedAt DESC LIMIT 1`
        )
        .get(testId, reportId) as
        | { analysis: string; model: string | null; category: string | null }
        | undefined;
      return row ?? null;
    }
    const row = this.db
      .prepare(
        `SELECT result AS analysis, model, category FROM llm_tasks
         WHERE testId = ? AND status = 'completed' AND result IS NOT NULL
         ORDER BY completedAt DESC LIMIT 1`
      )
      .get(testId) as
      | { analysis: string; model: string | null; category: string | null }
      | undefined;
    return row ?? null;
  }

  public findInflightReportSummary(reportId: string): { id: string } | null {
    const row = this.db
      .prepare(
        `SELECT id FROM llm_tasks
         WHERE type = 'report_summary' AND reportId = ?
           AND status IN ('queued','processing')
         LIMIT 1`
      )
      .get(reportId) as { id: string } | undefined;
    return row ?? null;
  }

  public findInflightProjectSummary(project: string): { id: string } | null {
    const row = this.db
      .prepare(
        `SELECT id FROM llm_tasks
         WHERE type = 'project_summary'
           AND project = ?
           AND status IN ('queued','processing')
         ORDER BY createdAt DESC
         LIMIT 1`
      )
      .get(project) as { id: string } | undefined;
    return row ?? null;
  }
}

export const llmTasksDb = singletonOf('llmTasks', () => new LlmTasksDatabase());

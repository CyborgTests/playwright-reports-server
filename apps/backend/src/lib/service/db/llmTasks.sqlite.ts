import type { LlmTaskStatus, LlmTaskType } from '@playwright-reports/shared';
import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { llmTaskEvents } from '../llmTaskEvents.js';
import { getDatabase } from './db.js';

export type { LlmTaskStatus, LlmTaskType } from '@playwright-reports/shared';

const initiatedLlmTasksDb = Symbol.for('playwright.reports.db.llmTasks');
const instance = globalThis as typeof globalThis & {
  [initiatedLlmTasksDb]?: LlmTasksDatabase;
};

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

  private constructor() {
    this.insertTaskStmt = this.db.prepare(`
      INSERT INTO llm_tasks (id, type, status, priority, reportId, testId, fileId, project, createdAt, isRetry, reportIds)
      VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.selectQueuedStmt = this.db.prepare(`
      SELECT * FROM llm_tasks
      WHERE status = 'queued'
        AND (
          type != 'report_summary'
          OR reportId IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM llm_tasks sibling
            WHERE sibling.reportId = t.reportId
              AND sibling.type = 'test_analysis'
              AND sibling.status IN ('queued', 'processing')
          )
        )
      ORDER BY priority DESC, createdAt ASC
      LIMIT ?
    `);

    this.claimTaskStmt = this.db.prepare(`
      UPDATE llm_tasks
      SET status = 'processing', startedAt = ?
      WHERE id = ?
    `);

    this.completeTaskStmt = this.db.prepare(`
      UPDATE llm_tasks
      SET status = 'completed', completedAt = ?, result = ?, category = ?, model = ?,
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

  public static getInstance(): LlmTasksDatabase {
    instance[initiatedLlmTasksDb] ??= new LlmTasksDatabase();
    return instance[initiatedLlmTasksDb];
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
    extras?: { usage?: LlmTaskUsage }
  ): void {
    const now = new Date().toISOString();
    const usage = extras?.usage;
    this.completeTaskStmt.run(
      now,
      result,
      category ?? null,
      model ?? null,
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
  }): { data: LlmTaskRow[]; total: number } {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (opts.status) {
      conditions.push('status = ?');
      params.push(opts.status);
    }
    if (opts.type) {
      conditions.push('type = ?');
      params.push(opts.type);
    }
    if (opts.reportId) {
      conditions.push('reportId = ?');
      params.push(opts.reportId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = this.db
      .prepare(`SELECT COUNT(*) as total FROM llm_tasks ${whereClause}`)
      .get(...params) as { total: number };

    const data = this.db
      .prepare(`SELECT * FROM llm_tasks ${whereClause} ORDER BY createdAt DESC LIMIT ? OFFSET ?`)
      .all(...params, opts.limit, opts.offset) as LlmTaskRow[];

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

  public updatePrompt(id: string, prompt: string): void {
    this.db.prepare('UPDATE llm_tasks SET prompt = ? WHERE id = ?').run(prompt, id);
  }

  public requeueWithRetryIncrement(id: string): void {
    this.db
      .prepare(
        "UPDATE llm_tasks SET status = 'queued', startedAt = NULL, retryCount = retryCount + 1 WHERE id = ?"
      )
      .run(id);
  }
}

export const llmTasksDb = LlmTasksDatabase.getInstance();

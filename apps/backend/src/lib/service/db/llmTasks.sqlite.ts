import { randomUUID as uuid } from 'node:crypto';
import type { LlmTaskStatus, LlmTaskType } from '@playwright-reports/shared';
import { sql } from 'kysely';
import { linkifyReportRefs } from '../../llm/linkifyReportRefs.js';
import { llmTaskEvents } from '../llmTaskEvents.js';
import { getDatabase } from './db.js';
import { getKysely, type LlmTasksRow } from './kysely.js';
import { singletonOf } from './singleton.js';

export type { LlmTaskStatus, LlmTaskType } from '@playwright-reports/shared';

export type LlmTaskRow = LlmTasksRow & {
  type: LlmTaskType;
  status: LlmTaskStatus;
};

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

const SELECT_QUEUED_SQL = `
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
`;

export class LlmTasksDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();

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

    const compiled = this.k
      .insertInto('llm_tasks')
      .values({
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
      })
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);

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

  public bulkCreateTestAnalysis(
    items: ReadonlyArray<{
      reportId?: string;
      testId?: string;
      fileId?: string;
      project?: string;
    }>
  ): number {
    if (items.length === 0) return 0;
    const tx = this.db.transaction((rows: typeof items) => {
      for (const row of rows) {
        this.createTask('test_analysis', {
          reportId: row.reportId,
          testId: row.testId,
          fileId: row.fileId,
          project: row.project,
        });
      }
    });
    tx(items);
    return items.length;
  }

  public markAsRetry(id: string): void {
    const compiled = this.k
      .updateTable('llm_tasks')
      .set({ isRetry: 1 })
      .where('id', '=', id)
      .where('status', '=', 'queued')
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public updateReportIds(id: string, reportIds: string[] | null): void {
    const json = reportIds && reportIds.length > 0 ? JSON.stringify(reportIds) : null;
    const compiled = this.k
      .updateTable('llm_tasks')
      .set({ reportIds: json })
      .where('id', '=', id)
      .where('status', 'in', ['queued', 'processing'])
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public claimNext(count: number): LlmTaskRow[] {
    const hasQueuedCompiled = this.k
      .selectFrom('llm_tasks')
      .select('id')
      .where('status', '=', 'queued')
      .limit(1)
      .compile();
    const hasQueued = this.db.prepare(hasQueuedCompiled.sql).get(...hasQueuedCompiled.parameters);
    if (!hasQueued) return [];

    const transaction = this.db.transaction(() => {
      const rows = this.db.prepare(SELECT_QUEUED_SQL).all(count) as LlmTaskRow[];
      const now = new Date().toISOString();

      const claimed: LlmTaskRow[] = [];
      for (const row of rows) {
        const claimCompiled = this.k
          .updateTable('llm_tasks')
          .set({ status: 'processing', startedAt: now })
          .where('id', '=', row.id)
          .where('status', '=', 'queued')
          .compile();
        const result = this.db.prepare(claimCompiled.sql).run(...claimCompiled.parameters);
        if (result.changes === 1) {
          row.status = 'processing';
          row.startedAt = now;
          claimed.push(row);
        }
      }

      return claimed;
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
    const projectCompiled = this.k
      .selectFrom('llm_tasks')
      .select('project')
      .where('id', '=', id)
      .compile();
    const projectRow = this.db.prepare(projectCompiled.sql).get(...projectCompiled.parameters) as
      | { project: string | null }
      | undefined;
    const linkifiedResult = linkifyReportRefs(result, {
      project: projectRow?.project && projectRow.project !== 'all' ? projectRow.project : undefined,
    });

    const compiled = this.k
      .updateTable('llm_tasks')
      .set({
        status: 'completed',
        completedAt: now,
        result: linkifiedResult,
        category: category ?? null,
        model: model ?? null,
        baseUrl: extras?.baseUrl ?? null,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        totalTokens: usage?.totalTokens ?? null,
      })
      .where('id', '=', id)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
    this.fireUpdateEvent(id);
  }

  public fail(id: string, error: string): void {
    const taskCompiled = this.k
      .selectFrom('llm_tasks')
      .select(['retryCount', 'maxRetries'])
      .where('id', '=', id)
      .compile();
    const task = this.db.prepare(taskCompiled.sql).get(...taskCompiled.parameters) as
      | { retryCount: number; maxRetries: number }
      | undefined;
    if (!task) return;

    if (task.retryCount < task.maxRetries) {
      const compiled = this.k
        .updateTable('llm_tasks')
        .set((eb) => ({
          status: 'queued',
          retryCount: eb('retryCount', '+', 1),
          error,
        }))
        .where('id', '=', id)
        .compile();
      this.db.prepare(compiled.sql).run(...compiled.parameters);
    } else {
      const compiled = this.k
        .updateTable('llm_tasks')
        .set({ status: 'failed', completedAt: new Date().toISOString(), error })
        .where('id', '=', id)
        .compile();
      this.db.prepare(compiled.sql).run(...compiled.parameters);
    }
    this.fireUpdateEvent(id);
  }

  /** Look up the post-update row and broadcast it to event subscribers. */
  private fireUpdateEvent(id: string): void {
    const compiled = this.k.selectFrom('llm_tasks').selectAll().where('id', '=', id).compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as LlmTaskRow | undefined;
    if (row) llmTaskEvents.emitTaskUpdate(row);
  }

  public cancel(id: string): void {
    const compiled = this.k
      .updateTable('llm_tasks')
      .set({ status: 'cancelled' })
      .where('id', '=', id)
      .where('status', '=', 'queued')
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
    this.fireUpdateEvent(id);
  }

  public failStaleProcessing(): number {
    const now = new Date().toISOString();
    const compiled = this.k
      .updateTable('llm_tasks')
      .set({
        status: 'failed',
        completedAt: now,
        error: 'Server restarted while task was processing',
      })
      .where('status', '=', 'processing')
      .compile();
    return Number(this.db.prepare(compiled.sql).run(...compiled.parameters).changes ?? 0);
  }

  public retry(id: string): void {
    const compiled = this.k
      .updateTable('llm_tasks')
      .set({
        status: 'queued',
        retryCount: 0,
        error: null,
        startedAt: null,
        completedAt: null,
        isRetry: 1,
      })
      .where('id', '=', id)
      .where('status', '=', 'failed')
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
    this.fireUpdateEvent(id);
  }

  public bulkDelete(ids: string[]): void {
    if (ids.length === 0) return;
    const compiled = this.k.deleteFrom('llm_tasks').where('id', 'in', ids).compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public clearQueue(): void {
    const compiled = this.k
      .deleteFrom('llm_tasks')
      .where('status', 'in', ['queued', 'cancelled'])
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public getStats(): {
    queued: number;
    processing: number;
    completed: number;
    failed: number;
    cancelled: number;
  } {
    const compiled = this.k
      .selectFrom('llm_tasks')
      .select((eb) => ['status', eb.fn.countAll<number>().as('count')])
      .groupBy('status')
      .compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      status: string;
      count: number;
    }>;
    const stats = { queued: 0, processing: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const row of rows) {
      if (row.status in stats) {
        stats[row.status as keyof typeof stats] = row.count;
      }
    }
    return stats;
  }

  public getInflightCountForReport(reportId: string): number {
    const compiled = this.k
      .selectFrom('llm_tasks')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('reportId', '=', reportId)
      .where('status', 'in', ['queued', 'processing'])
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | { count: number }
      | undefined;
    return row?.count ?? 0;
  }

  public getInflightCountForProject(project: string): number {
    const compiled = this.k
      .selectFrom('llm_tasks')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('type', '=', 'project_summary')
      .where('project', '=', project)
      .where('status', 'in', ['queued', 'processing'])
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | { count: number }
      | undefined;
    return row?.count ?? 0;
  }

  public getTasksPaginated(opts: {
    status?: LlmTaskStatus;
    type?: LlmTaskType;
    reportId?: string;
    model?: string;
    limit: number;
    offset: number;
  }): { data: LlmTaskRowEnriched[]; total: number } {
    let countQuery = this.k
      .selectFrom('llm_tasks as t')
      .select((eb) => eb.fn.countAll<number>().as('total'));
    if (opts.status) countQuery = countQuery.where('t.status', '=', opts.status);
    if (opts.type) countQuery = countQuery.where('t.type', '=', opts.type);
    if (opts.reportId) countQuery = countQuery.where('t.reportId', '=', opts.reportId);
    if (opts.model) countQuery = countQuery.where('t.model', '=', opts.model);
    const countCompiled = countQuery.compile();
    const total = (
      this.db.prepare(countCompiled.sql).get(...countCompiled.parameters) as { total: number }
    ).total;

    let dataQuery = this.k
      .selectFrom('llm_tasks as t')
      .leftJoin('reports as r', 'r.reportID', 't.reportId')
      .leftJoin('tests as te', (join) =>
        join
          .onRef('te.testId', '=', 't.testId')
          .onRef('te.fileId', '=', 't.fileId')
          .onRef('te.project', '=', 't.project')
      )
      .selectAll('t')
      .select([
        'r.displayNumber as reportDisplayNumber',
        'r.title as reportTitle',
        'te.title as testTitle',
      ])
      .orderBy('t.createdAt', 'desc')
      .limit(opts.limit)
      .offset(opts.offset);
    if (opts.status) dataQuery = dataQuery.where('t.status', '=', opts.status);
    if (opts.type) dataQuery = dataQuery.where('t.type', '=', opts.type);
    if (opts.reportId) dataQuery = dataQuery.where('t.reportId', '=', opts.reportId);
    if (opts.model) dataQuery = dataQuery.where('t.model', '=', opts.model);
    const dataCompiled = dataQuery.compile();
    const data = this.db
      .prepare(dataCompiled.sql)
      .all(...dataCompiled.parameters) as Array<LlmTaskRowEnriched>;

    return { data, total };
  }

  public getDistinctModels(): string[] {
    const compiled = this.k
      .selectFrom('llm_tasks')
      .select('model')
      .distinct()
      .where('model', 'is not', null)
      .orderBy('model', 'asc')
      .compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      model: string | null;
    }>;
    return rows.map((r) => r.model).filter((m): m is string => !!m && m.length > 0);
  }

  public getByReport(reportId: string): LlmTaskRow[] {
    const compiled = this.k
      .selectFrom('llm_tasks')
      .selectAll()
      .where('reportId', '=', reportId)
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as LlmTaskRow[];
  }

  public getTestAnalysisTasksForReport(reportId: string): LlmTaskRow[] {
    const compiled = this.k
      .selectFrom('llm_tasks')
      .selectAll()
      .where('reportId', '=', reportId)
      .where('type', '=', 'test_analysis')
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as LlmTaskRow[];
  }

  public areAllTestTasksComplete(reportId: string): boolean {
    const compiled = this.k
      .selectFrom('llm_tasks')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('reportId', '=', reportId)
      .where('type', '=', 'test_analysis')
      .where('status', 'not in', ['completed', 'cancelled', 'failed'])
      .compile();
    const result = this.db.prepare(compiled.sql).get(...compiled.parameters) as { count: number };
    return result.count === 0;
  }

  public deleteByReport(reportId: string): void {
    const compiled = this.k.deleteFrom('llm_tasks').where('reportId', '=', reportId).compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public deleteByReportIds(reportIds: string[]): void {
    if (reportIds.length === 0) return;
    const compiled = this.k.deleteFrom('llm_tasks').where('reportId', 'in', reportIds).compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public pruneCompletedOlderThan(cutoffISO: string): number {
    const compiled = this.k
      .deleteFrom('llm_tasks')
      .where('status', '=', 'completed')
      .where('completedAt', 'is not', null)
      .where('completedAt', '<', cutoffISO)
      .compile();
    return Number(this.db.prepare(compiled.sql).run(...compiled.parameters).changes ?? 0);
  }

  public updatePrompt(id: string, prompt: string, estimatedInputTokens: number): void {
    const compiled = this.k
      .updateTable('llm_tasks')
      .set({ prompt, inputTokens: estimatedInputTokens })
      .where('id', '=', id)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
    this.fireUpdateEvent(id);
  }

  public getById(id: string): LlmTaskRow | null {
    const compiled = this.k.selectFrom('llm_tasks').selectAll().where('id', '=', id).compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as LlmTaskRow | undefined;
    return row ?? null;
  }

  public getLatestCompletedTestAnalysisTask(testId: string, reportId: string): LlmTaskRow | null {
    const compiled = this.k
      .selectFrom('llm_tasks')
      .selectAll()
      .where('type', '=', 'test_analysis')
      .where('status', '=', 'completed')
      .where('testId', '=', testId)
      .where('reportId', '=', reportId)
      .orderBy(sql`COALESCE(completedAt, createdAt)`, 'desc')
      .limit(1)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as LlmTaskRow | undefined;
    return row ?? null;
  }

  public requeueWithRetryIncrement(id: string): void {
    const compiled = this.k
      .updateTable('llm_tasks')
      .set((eb) => ({
        status: 'queued',
        startedAt: null,
        retryCount: eb('retryCount', '+', 1),
      }))
      .where('id', '=', id)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public findInflightTestAnalysis(
    testId: string,
    reportId: string | null | undefined,
    options: { retryOnly?: boolean } = {}
  ): { id: string; status: string } | null {
    let q = this.k
      .selectFrom('llm_tasks')
      .select(['id', 'status'])
      .where('type', '=', 'test_analysis')
      .where('testId', '=', testId)
      .where('status', 'in', ['queued', 'processing'])
      .orderBy('createdAt', 'desc')
      .limit(1);
    if (reportId) q = q.where('reportId', '=', reportId);
    if (options.retryOnly) q = q.where('isRetry', '=', 1);
    const compiled = q.compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | { id: string; status: string }
      | undefined;
    return row ?? null;
  }

  public getLatestCompletedTestAnalysisResult(
    testId: string,
    reportId: string | null | undefined
  ): { analysis: string; model: string | null; category: string | null } | null {
    let q = this.k
      .selectFrom('llm_tasks')
      .select(['result as analysis', 'model', 'category'])
      .where('testId', '=', testId)
      .where('status', '=', 'completed')
      .where('result', 'is not', null)
      .orderBy('completedAt', 'desc')
      .limit(1);
    if (reportId) q = q.where('reportId', '=', reportId);
    const compiled = q.compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | { analysis: string; model: string | null; category: string | null }
      | undefined;
    return row ?? null;
  }

  public findInflightReportSummary(reportId: string): { id: string } | null {
    const compiled = this.k
      .selectFrom('llm_tasks')
      .select('id')
      .where('type', '=', 'report_summary')
      .where('reportId', '=', reportId)
      .where('status', 'in', ['queued', 'processing'])
      .limit(1)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | { id: string }
      | undefined;
    return row ?? null;
  }

  public findInflightProjectSummary(project: string): { id: string } | null {
    const compiled = this.k
      .selectFrom('llm_tasks')
      .select('id')
      .where('type', '=', 'project_summary')
      .where('project', '=', project)
      .where('status', 'in', ['queued', 'processing'])
      .orderBy('createdAt', 'desc')
      .limit(1)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | { id: string }
      | undefined;
    return row ?? null;
  }
}

export const llmTasksDb = singletonOf('llmTasks', () => new LlmTasksDatabase());

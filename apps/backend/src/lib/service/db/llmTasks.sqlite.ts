import { randomUUID as uuid } from 'node:crypto';
import type {
  LlmDurationEstimate,
  LlmEstimates,
  LlmTaskChildUsage,
  LlmTaskStatus,
  LlmTaskType,
} from '@playwright-reports/shared';
import {
  parentEstimateKey,
  roleEstimateKey,
  strategyEstimateKey,
} from '@playwright-reports/shared';
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

export type ClaimCandidate = Pick<
  LlmTaskRow,
  'id' | 'type' | 'reportId' | 'testId' | 'project' | 'priority' | 'createdAt'
>;

export interface LlmTaskRowEnriched extends LlmTaskRow {
  reportDisplayNumber: number | null;
  reportTitle: string | null;
  testTitle: string | null;
  childUsage?: LlmTaskChildUsage[];
}

function parseChildUsage(json: string | null | undefined): LlmTaskChildUsage[] | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as LlmTaskChildUsage[];
  } catch {
    // malformed rollup -> fall back to lazy /roles fetch
  }
  return undefined;
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
  SELECT t.id, t.type, t.reportId, t.testId, t.project, t.priority, t.createdAt FROM llm_tasks t
  WHERE t.status = 'queued'
    AND t.parentTaskId IS NULL
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

const CLAIM_SCAN_LIMIT = 200;

const FRESH_SAMPLE_PREDICATE = `
  t.completedAt > COALESCE(
    (SELECT MAX(m.updatedAt) FROM llm_models m
      WHERE m.model = t.model AND m.baseUrl = COALESCE(t.baseUrl, '')), '')
  AND t.completedAt > COALESCE(
    (SELECT MAX(g.updatedAt) FROM llm_concurrency_groups g
      JOIN llm_models m2 ON m2.concurrencyGroupId = g.id
      WHERE m2.model = t.model AND m2.baseUrl = COALESCE(t.baseUrl, '')), '')
`;

const DURATION_MS_EXPR = '(julianday(t.completedAt) - julianday(t.startedAt)) * 86400000.0';

const PARENT_ESTIMATES_SQL = `
  SELECT t.type AS type, COALESCE(t.strategy, 'one_shot') AS strategy, t.model AS model,
    COALESCE(t.baseUrl, '') AS baseUrl,
    AVG(${DURATION_MS_EXPR}) AS meanMs, COUNT(*) AS samples
  FROM llm_tasks t
  WHERE t.status = 'completed' AND t.parentTaskId IS NULL
    AND t.startedAt IS NOT NULL AND t.completedAt IS NOT NULL AND t.model IS NOT NULL
    AND ${FRESH_SAMPLE_PREDICATE}
  GROUP BY t.type, COALESCE(t.strategy, 'one_shot'), t.model, COALESCE(t.baseUrl, '')
  HAVING samples >= ?
`;

const PARENT_BY_STRATEGY_ESTIMATES_SQL = `
  SELECT t.type AS type, COALESCE(t.strategy, 'one_shot') AS strategy,
    AVG(${DURATION_MS_EXPR}) AS meanMs, COUNT(*) AS samples
  FROM llm_tasks t
  WHERE t.status = 'completed' AND t.parentTaskId IS NULL
    AND t.startedAt IS NOT NULL AND t.completedAt IS NOT NULL AND t.model IS NOT NULL
    AND ${FRESH_SAMPLE_PREDICATE}
  GROUP BY t.type, COALESCE(t.strategy, 'one_shot')
  HAVING samples >= ?
`;

const ROLE_ESTIMATES_SQL = `
  SELECT t.type AS type, COALESCE(p.strategy, 'one_shot') AS strategy, t.role AS role,
    t.model AS model, COALESCE(t.baseUrl, '') AS baseUrl,
    AVG(${DURATION_MS_EXPR}) AS meanMs, COUNT(*) AS samples
  FROM llm_tasks t
  JOIN llm_tasks p ON p.id = t.parentTaskId
  WHERE t.status = 'completed' AND t.parentTaskId IS NOT NULL AND t.role IS NOT NULL
    AND t.startedAt IS NOT NULL AND t.completedAt IS NOT NULL AND t.model IS NOT NULL
    AND ${FRESH_SAMPLE_PREDICATE}
  GROUP BY t.type, COALESCE(p.strategy, 'one_shot'), t.role, t.model, COALESCE(t.baseUrl, '')
  HAVING samples >= ?
`;

const ESTIMATE_CACHE_TTL_MS = 60_000;

interface ParentEstimateRow {
  type: string;
  strategy: string;
  model: string;
  baseUrl: string;
  meanMs: number;
  samples: number;
}

interface RoleEstimateRow extends ParentEstimateRow {
  role: string;
}

interface StrategyEstimateRow {
  type: string;
  strategy: string;
  meanMs: number;
  samples: number;
}

export interface ScheduledEtaTask {
  id: string;
  type: LlmTaskType;
  status: LlmTaskStatus;
  startedAt: string | null;
  priority: number;
  createdAt: string;
  reportId: string | null;
  project: string | null;
}

export class LlmTasksDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();
  private estimateCache: { at: number; minSamples: number; value: LlmEstimates } | null = null;

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

    const row: LlmTaskRow = {
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
      parentTaskId: null,
      role: null,
      strategy: null,
    };

    const compiled = this.k.insertInto('llm_tasks').values(row).compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
    llmTaskEvents.emitEnqueue();

    return row;
  }

  public startRoleExecution(opts: {
    parentTaskId: string;
    type: LlmTaskType;
    role: string;
    model?: string | null;
    baseUrl?: string | null;
  }): string {
    const id = uuid();
    const now = new Date().toISOString();
    const compiled = this.k
      .insertInto('llm_tasks')
      .values({
        id,
        type: opts.type,
        status: 'queued',
        priority: 0,
        reportId: null,
        testId: null,
        fileId: null,
        project: null,
        prompt: null,
        result: null,
        category: null,
        model: opts.model ?? null,
        error: null,
        createdAt: now,
        startedAt: null,
        completedAt: null,
        retryCount: 0,
        maxRetries: 0,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        isRetry: 0,
        reportIds: null,
        baseUrl: opts.baseUrl ?? null,
        parentTaskId: opts.parentTaskId,
        role: opts.role,
        strategy: null,
      })
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
    return id;
  }

  public markRoleProcessing(id: string): void {
    const compiled = this.k
      .updateTable('llm_tasks')
      .set({ status: 'processing', startedAt: new Date().toISOString() })
      .where('id', '=', id)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public finishRoleExecution(
    id: string,
    opts: {
      status: 'completed' | 'failed';
      model?: string | null;
      baseUrl?: string | null;
      usage?: LlmTaskUsage;
      error?: string | null;
      result?: string | null;
      category?: string | null;
    }
  ): void {
    const input = opts.usage?.inputTokens ?? null;
    const output = opts.usage?.outputTokens ?? null;
    const total =
      opts.usage?.totalTokens ?? (input != null && output != null ? input + output : null);
    const compiled = this.k
      .updateTable('llm_tasks')
      .set({
        status: opts.status,
        completedAt: new Date().toISOString(),
        model: opts.model ?? null,
        baseUrl: opts.baseUrl ?? null,
        inputTokens: input,
        outputTokens: output,
        totalTokens: total,
        error: opts.error ?? null,
        result: opts.result ?? null,
        category: opts.category ?? null,
      })
      .where('id', '=', id)
      .where('status', '!=', 'cancelled')
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public setInFlightModel(id: string, model: string | null, baseUrl: string | null): void {
    const compiled = this.k
      .updateTable('llm_tasks')
      .set({ model: model ?? null, baseUrl: baseUrl ?? null })
      .where('id', '=', id)
      .where('status', '=', 'processing')
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public recordFailedAttempt(opts: {
    parentTaskId: string;
    type: LlmTaskType;
    model?: string | null;
    baseUrl?: string | null;
    error: string;
  }): void {
    const id = uuid();
    const now = new Date().toISOString();
    const compiled = this.k
      .insertInto('llm_tasks')
      .values({
        id,
        type: opts.type,
        status: 'failed',
        priority: 0,
        reportId: null,
        testId: null,
        fileId: null,
        project: null,
        prompt: null,
        result: null,
        category: null,
        model: opts.model ?? null,
        error: opts.error,
        createdAt: now,
        startedAt: now,
        completedAt: now,
        retryCount: 0,
        maxRetries: 0,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        isRetry: 0,
        reportIds: null,
        baseUrl: opts.baseUrl ?? null,
        parentTaskId: opts.parentTaskId,
        role: 'fallback',
        strategy: null,
      })
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public getRoleChildren(parentId: string): LlmTaskRow[] {
    const compiled = this.k
      .selectFrom('llm_tasks')
      .selectAll()
      .where('parentTaskId', '=', parentId)
      .orderBy('createdAt', 'asc')
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as LlmTaskRow[];
  }

  public markStrategy(id: string, strategy: string): void {
    const compiled = this.k
      .updateTable('llm_tasks')
      .set({ strategy })
      .where('id', '=', id)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
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

  public hasQueued(): boolean {
    const compiled = this.k
      .selectFrom('llm_tasks')
      .select('id')
      .where('status', '=', 'queued')
      .where('parentTaskId', 'is', null)
      .limit(1)
      .compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) !== undefined;
  }

  public claimNextRunnable(
    decide: (task: ClaimCandidate) => {
      run: boolean;
      reservation?: { gateKey: string; release: () => void };
    }
  ): { task: LlmTaskRow; reservation?: { gateKey: string; release: () => void } } | null {
    const hasQueuedCompiled = this.k
      .selectFrom('llm_tasks')
      .select('id')
      .where('status', '=', 'queued')
      .limit(1)
      .compile();
    const hasQueued = this.db.prepare(hasQueuedCompiled.sql).get(...hasQueuedCompiled.parameters);
    if (!hasQueued) return null;

    const transaction = this.db.transaction(() => {
      const rows = this.db.prepare(SELECT_QUEUED_SQL).all(CLAIM_SCAN_LIMIT) as ClaimCandidate[];
      const now = new Date().toISOString();
      for (const row of rows) {
        const decision = decide(row);
        if (!decision.run) continue;
        const claimCompiled = this.k
          .updateTable('llm_tasks')
          .set({ status: 'processing', startedAt: now })
          .where('id', '=', row.id)
          .where('status', '=', 'queued')
          .compile();
        const result = this.db.prepare(claimCompiled.sql).run(...claimCompiled.parameters);
        if (result.changes === 1) {
          const task = this.getById(row.id);
          if (task) return { task, reservation: decision.reservation };
        }
        // Lost the row to a concurrent claim - undo any reservation and keep scanning.
        decision.reservation?.release();
      }
      return null;
    });

    const result = transaction();
    if (result) this.fireUpdateEvent(result.task.id);
    return result;
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
      .where('status', '!=', 'cancelled')
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
    this.fireUpdateEvent(id);
  }

  public fail(id: string, error: string): void {
    const taskCompiled = this.k
      .selectFrom('llm_tasks')
      .select(['retryCount', 'maxRetries', 'status'])
      .where('id', '=', id)
      .compile();
    const task = this.db.prepare(taskCompiled.sql).get(...taskCompiled.parameters) as
      | { retryCount: number; maxRetries: number; status: string }
      | undefined;
    if (!task || task.status === 'cancelled') return;

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
      llmTaskEvents.emitEnqueue();
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

  private fireUpdateEvent(id: string): void {
    const compiled = this.k.selectFrom('llm_tasks').selectAll().where('id', '=', id).compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as LlmTaskRow | undefined;
    if (row) llmTaskEvents.emitTaskUpdate(row);
  }

  public cancelTree(id: string): string[] {
    const now = new Date().toISOString();
    const childIds = this.getRoleChildren(id).map((c) => c.id);
    const ids = [id, ...childIds];
    const changed: string[] = [];
    const tx = this.db.transaction(() => {
      for (const targetId of ids) {
        const compiled = this.k
          .updateTable('llm_tasks')
          .set({ status: 'cancelled', completedAt: now })
          .where('id', '=', targetId)
          .where('status', 'in', ['queued', 'processing'])
          .compile();
        const res = this.db.prepare(compiled.sql).run(...compiled.parameters);
        if (Number(res.changes ?? 0) > 0) changed.push(targetId);
      }
    });
    tx();
    for (const targetId of changed) this.fireUpdateEvent(targetId);
    return changed;
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
    llmTaskEvents.emitEnqueue();
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
      if (Object.hasOwn(stats, row.status)) {
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
      .select((eb) => eb.fn.countAll<number>().as('total'))
      .where('t.parentTaskId', 'is', null);
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
      .select((eb) =>
        eb
          .selectFrom('llm_tasks as ch')
          .select((e) => e.fn.countAll<number>().as('c'))
          .whereRef('ch.parentTaskId', '=', 't.id')
          .as('childCount')
      )
      .select((eb) =>
        eb
          .selectFrom('llm_tasks as cu')
          .select(
            sql<string>`json_group_array(json_object('baseUrl', cu.baseUrl, 'model', cu.model, 'inputTokens', cu.inputTokens, 'outputTokens', cu.outputTokens))`.as(
              'u'
            )
          )
          .whereRef('cu.parentTaskId', '=', 't.id')
          .where('cu.status', '=', 'completed')
          .as('childUsageJson')
      )
      .where('t.parentTaskId', 'is', null)
      .orderBy('t.createdAt', 'desc')
      .limit(opts.limit)
      .offset(opts.offset);
    if (opts.status) dataQuery = dataQuery.where('t.status', '=', opts.status);
    if (opts.type) dataQuery = dataQuery.where('t.type', '=', opts.type);
    if (opts.reportId) dataQuery = dataQuery.where('t.reportId', '=', opts.reportId);
    if (opts.model) dataQuery = dataQuery.where('t.model', '=', opts.model);
    const dataCompiled = dataQuery.compile();
    const rows = this.db.prepare(dataCompiled.sql).all(...dataCompiled.parameters) as Array<
      LlmTaskRowEnriched & { childUsageJson?: string }
    >;

    const data: LlmTaskRowEnriched[] = rows.map(({ childUsageJson, ...row }) => ({
      ...row,
      childUsage: parseChildUsage(childUsageJson),
    }));

    return { data, total };
  }

  public getScheduledForEta(): ScheduledEtaTask[] {
    const compiled = this.k
      .selectFrom('llm_tasks')
      .select(['id', 'type', 'status', 'startedAt', 'priority', 'createdAt', 'reportId', 'project'])
      .where('parentTaskId', 'is', null)
      .where('status', 'in', ['queued', 'processing'])
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as ScheduledEtaTask[];
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

  public getDurationEstimates(minSamples: number): LlmEstimates {
    const now = Date.now();
    if (
      this.estimateCache &&
      this.estimateCache.minSamples === minSamples &&
      now - this.estimateCache.at < ESTIMATE_CACHE_TTL_MS
    ) {
      return this.estimateCache.value;
    }

    const parentRows = this.db.prepare(PARENT_ESTIMATES_SQL).all(minSamples) as ParentEstimateRow[];
    const byStrategyRows = this.db
      .prepare(PARENT_BY_STRATEGY_ESTIMATES_SQL)
      .all(minSamples) as StrategyEstimateRow[];
    const roleRows = this.db.prepare(ROLE_ESTIMATES_SQL).all(minSamples) as RoleEstimateRow[];

    const parents: Record<string, LlmDurationEstimate> = {};
    for (const r of parentRows) {
      parents[parentEstimateKey(r.type, r.strategy, r.model, r.baseUrl)] = {
        meanMs: Math.round(r.meanMs),
        sampleCount: r.samples,
      };
    }
    const parentsByStrategy: Record<string, LlmDurationEstimate> = {};
    for (const r of byStrategyRows) {
      parentsByStrategy[strategyEstimateKey(r.type, r.strategy)] = {
        meanMs: Math.round(r.meanMs),
        sampleCount: r.samples,
      };
    }
    const roles: Record<string, LlmDurationEstimate> = {};
    for (const r of roleRows) {
      roles[roleEstimateKey(r.type, r.strategy, r.role, r.model, r.baseUrl)] = {
        meanMs: Math.round(r.meanMs),
        sampleCount: r.samples,
      };
    }

    const value: LlmEstimates = { parents, parentsByStrategy, roles };
    this.estimateCache = { at: now, minSamples, value };
    return value;
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
    llmTaskEvents.emitEnqueue();
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

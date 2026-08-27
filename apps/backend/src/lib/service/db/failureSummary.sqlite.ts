import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { ReportAnalysisStructured } from '@playwright-reports/shared';
import { linkifyReportAnalysisStructured, linkifyReportRefs } from '../../llm/linkifyReportRefs.js';
import { getDatabase, getDatabasePath } from './db.js';
import { getKysely } from './kysely.js';
import { singletonOf } from './singleton.js';
import { parseJsonColumn } from './utils.js';

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

const AGGREGATED_CATEGORIES_TTL_MS = 60_000;
const AGGREGATED_CATEGORIES_CACHE_MAX = 100;

type AggregatedCategoriesResult = Awaited<
  ReturnType<FailureSummaryDatabase['getAggregatedCategories']>
>;

interface WorkerResult {
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
    regressedTestCount: number;
    affectedTests?: Array<{
      testId: string;
      title: string;
      filePath?: string;
      project: string;
      reportId: string;
      reportUrl?: string;
      isRegressed?: boolean;
    }>;
  }>;
}

const AGGREGATE_WORKER_TIMEOUT_MS = 30_000;

function resolveAggregateWorkerPath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, '..', 'workers', 'failureAggregateWorker.mjs'),
    path.join(moduleDir, 'failureAggregateWorker.mjs'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`failure-categories worker not found (looked in: ${candidates.join(', ')})`);
}

function runAggregateWorker(workerData: {
  dbPath: string;
  project?: string;
  limit: number;
  from?: string;
  to?: string;
}): Promise<WorkerResult> {
  const workerPath = resolveAggregateWorkerPath();
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error('failure-categories aggregation timed out'));
    }, AGGREGATE_WORKER_TIMEOUT_MS);
    const settle = () => clearTimeout(timer);
    worker.on('message', (msg: unknown) => {
      settle();
      void worker.terminate();
      const error = (msg as { __workerError?: string }).__workerError;
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve(msg as WorkerResult);
    });
    worker.on('error', (error: Error) => {
      settle();
      reject(error);
    });
    worker.on('exit', (code: number) => {
      settle();
      if (code !== 0) reject(new Error(`aggregation worker exited with code ${code}`));
    });
  });
}

export class FailureSummaryDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();
  private readonly aggregatedCategoriesCache = new Map<
    string,
    { value: AggregatedCategoriesResult; expiresAt: number }
  >();

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
    const compiled = this.k
      .insertInto('report_failure_summaries')
      .values({
        reportId,
        project,
        totalFailures,
        categories: JSON.stringify(categories),
        llmSummary: null,
        llmModel: null,
        llmSummaryStructured: null,
        createdAt: now,
        updatedAt: null,
      })
      .onConflict((oc) =>
        oc.column('reportId').doUpdateSet((eb) => ({
          project: eb.ref('excluded.project'),
          totalFailures: eb.ref('excluded.totalFailures'),
          categories: eb.ref('excluded.categories'),
          updatedAt: now,
        }))
      )
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public getSummary(reportId: string): FailureSummaryRow | null {
    const compiled = this.k
      .selectFrom('report_failure_summaries')
      .selectAll()
      .where('reportId', '=', reportId)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | FailureSummaryDbRow
      | undefined;
    return row ? this.parseRow(row) : null;
  }

  public updateLlmSummary(
    reportId: string,
    llmSummary: string,
    structured: ReportAnalysisStructured | null,
    llmModel?: string | null
  ): void {
    const projectCompiled = this.k
      .selectFrom('report_failure_summaries')
      .select('project')
      .where('reportId', '=', reportId)
      .compile();
    const projectRow = this.db.prepare(projectCompiled.sql).get(...projectCompiled.parameters) as
      | { project: string }
      | undefined;
    const ctx = { project: projectRow?.project || undefined };
    const linkifiedSummary = linkifyReportRefs(llmSummary, ctx);
    const linkifiedStructured = structured
      ? linkifyReportAnalysisStructured(structured, ctx)
      : null;

    const compiled = this.k
      .updateTable('report_failure_summaries')
      .set({
        llmSummary: linkifiedSummary,
        llmSummaryStructured: linkifiedStructured ? JSON.stringify(linkifiedStructured) : null,
        llmModel: llmModel ?? null,
        updatedAt: new Date().toISOString(),
      })
      .where('reportId', '=', reportId)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

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

    let q = this.k
      .selectFrom('report_failure_summaries')
      .selectAll()
      .where('totalFailures', '>', 0)
      .orderBy('createdAt', 'desc')
      .limit(limit);
    if (hasProject) q = q.where('project', '=', project);
    if (opts?.from) q = q.where('createdAt', '>=', opts.from);
    if (opts?.to) q = q.where('createdAt', '<', opts.to);
    if (defaultCutoff) q = q.where('createdAt', '>=', defaultCutoff);

    const compiled = q.compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as FailureSummaryDbRow[];
    return rows.map((row) => this.parseRow(row));
  }

  /**
   * Aggregate failure categories and top error groups from `test_runs`.
   * Runs in a worker thread (non-blocking); see runAggregateWorker.
   */
  public async getAggregatedCategories(
    project?: string,
    limit = 10,
    opts?: { from?: string; to?: string }
  ): Promise<WorkerResult> {
    const cacheKey = `${project ?? ''}|${limit}|${opts?.from ?? ''}|${opts?.to ?? ''}`;
    const cached = this.aggregatedCategoriesCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const result = await runAggregateWorker({
      dbPath: getDatabasePath(),
      project,
      limit,
      from: opts?.from,
      to: opts?.to,
    });
    this.pruneAggregatedCategoriesCache();
    this.aggregatedCategoriesCache.set(cacheKey, {
      value: result,
      expiresAt: Date.now() + AGGREGATED_CATEGORIES_TTL_MS,
    });
    return result;
  }

  public invalidateAggregatedCategories(): void {
    this.aggregatedCategoriesCache.clear();
  }

  private pruneAggregatedCategoriesCache(): void {
    const cache = this.aggregatedCategoriesCache;
    if (cache.size < AGGREGATED_CATEGORIES_CACHE_MAX) return;
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
    while (cache.size >= AGGREGATED_CATEGORIES_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
}

export const failureSummaryDb = singletonOf('failureSummary', () => new FailureSummaryDatabase());

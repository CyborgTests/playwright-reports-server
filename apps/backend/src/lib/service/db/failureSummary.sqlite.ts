import type { ReportAnalysisStructured } from '@playwright-reports/shared';
import { sql } from 'kysely';
import { linkifyReportAnalysisStructured, linkifyReportRefs } from '../../llm/linkifyReportRefs.js';
import { getDatabase } from './db.js';
import { decodeFailureDetails } from './failureDetailsCodec.js';
import { getKysely } from './kysely.js';
import { regressionsDb } from './regressions.sqlite.js';
import { singletonOf } from './singleton.js';
import { chunk, parseJsonColumn } from './utils.js';

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

type AggregatedCategoriesResult = ReturnType<FailureSummaryDatabase['getAggregatedCategories']>;

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
   * Aggregate failure categories and top error groups directly from `test_runs`.
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
  } {
    const cacheKey = `${project ?? ''}|${limit}|${opts?.from ?? ''}|${opts?.to ?? ''}`;
    const cached = this.aggregatedCategoriesCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const MAX_ROWS_SCANNED = 10_000;
    let q = this.k
      .selectFrom('test_runs')
      .select([
        'testId',
        'fileId',
        'project',
        'reportId',
        'outcome',
        'failure_category as category',
        'error_signature as signature',
        'error_signature_global as signatureGlobal',
        'failure_details',
        'createdAt',
      ])
      .where('failure_category', 'is not', null)
      .orderBy(sql`CASE WHEN outcome IN ('failed', 'unexpected') THEN 0 ELSE 1 END`, 'asc')
      .orderBy('createdAt', 'desc')
      .limit(MAX_ROWS_SCANNED);
    if (project && project !== 'all') q = q.where('project', '=', project);
    if (opts?.from) q = q.where('createdAt', '>=', opts.from);
    if (opts?.to) q = q.where('createdAt', '<', opts.to);
    const compiled = q.compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      testId: string;
      fileId: string;
      project: string;
      reportId: string;
      outcome: string;
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

    const reportIds = new Set<string>();
    for (const e of topErrors) {
      if (e.sampleReportId) reportIds.add(e.sampleReportId);
      for (const ex of e.examples) reportIds.add(ex.reportId);
    }
    let urlMap = new Map<string, string>();
    if (reportIds.size > 0) {
      const urlCompiled = this.k
        .selectFrom('reports')
        .select(['reportID', 'reportUrl'])
        .where('reportID', 'in', Array.from(reportIds))
        .compile();
      const reportRows = this.db.prepare(urlCompiled.sql).all(...urlCompiled.parameters) as Array<{
        reportID: string;
        reportUrl: string;
      }>;
      urlMap = new Map(reportRows.map((r) => [r.reportID, r.reportUrl]));
    }

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
      // VALUES tuple matching doesn't fit Kysely's typed builder; raw SQL fragment.
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

    const allTestKeys = Array.from(testKeys).map((k) => {
      const [testId, fileId, project] = k.split('::');
      return { testId, fileId, project };
    });
    const regMap = regressionsDb.getOpenForTests(allTestKeys);

    const result = {
      categories,
      totalFailures,
      topErrors: topErrors.map((e) => {
        const affectedTests = e.examples.map((ex) => {
          const t = titleMap.get(makeTestKey(ex.testId, ex.fileId, ex.project));
          const isRegressed = regMap.has(makeTestKey(ex.testId, ex.fileId, ex.project));
          return {
            testId: ex.testId,
            title: t?.title ?? ex.testId,
            filePath: t?.filePath,
            project: ex.project,
            reportId: ex.reportId,
            reportUrl: urlMap.get(ex.reportId),
            isRegressed,
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
    this.pruneAggregatedCategoriesCache();
    this.aggregatedCategoriesCache.set(cacheKey, {
      value: result,
      expiresAt: Date.now() + AGGREGATED_CATEGORIES_TTL_MS,
    });
    return result;
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

  public deleteAll(): void {
    const compiled = this.k.deleteFrom('report_failure_summaries').compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
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

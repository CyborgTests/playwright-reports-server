import { apiGet, apiPost } from '../client.js';
import { resolveConfig } from '../config.js';
import { clampToRange, emitJson } from '../format.js';
import { readJsonInput, readTextInput } from '../input.js';
import type {
  DiffTestEntry,
  DurationDeltaEntry,
  ReportBrief,
  ReportCompareResponse,
  ReportListResponse,
  ReportResolveResponse,
} from '../types.js';

interface LatestOpts {
  project?: string;
  withFailures?: boolean;
}

export async function runReportLatest(opts: LatestOpts): Promise<void> {
  const config = resolveConfig();
  const list = await apiGet<ReportListResponse>(config, '/api/report/list', {
    project: opts.project,
    limit: 1,
  });
  const latest = list.reports[0];
  if (!latest) {
    emitJson({ report: null });
    return;
  }
  const brief = await apiGet<ReportBrief>(
    config,
    `/api/cli/report/${encodeURIComponent(latest.reportID)}/brief`,
    opts.withFailures ? { mode: 'full' } : {}
  );
  emitJson(brief);
}

interface ReportBriefOpts {
  withFailures?: boolean;
}

/**
 * Default mode returns a compact payload: stats + clusterSummary (with the
 * first few failed tests sampled per cluster) + a few unclustered sample
 * failures. Pass `--with-failures` to get every failed test's full brief -
 * use sparingly, a 50-failure report in full mode is ~100 KB.
 */
export async function runReportBrief(reportId: string, opts: ReportBriefOpts): Promise<void> {
  if (!reportId) {
    throw new Error('Usage: pwrs-cli report brief <reportId> [--with-failures]');
  }
  const config = resolveConfig();
  const brief = await apiGet<ReportBrief>(
    config,
    `/api/cli/report/${encodeURIComponent(reportId)}/brief`,
    opts.withFailures ? { mode: 'full' } : {}
  );
  emitJson(brief);
}

interface ReportListOpts {
  project?: string;
  search?: string;
  tags?: string;
  from?: string;
  to?: string;
  passRate?: string;
  limit?: number;
  offset?: number;
}

const REPORT_LIST_DEFAULT_LIMIT = 20;
const REPORT_LIST_MAX_LIMIT = 100;

export async function runReportList(opts: ReportListOpts): Promise<void> {
  const config = resolveConfig();
  const requestedLimit = opts.limit ?? REPORT_LIST_DEFAULT_LIMIT;
  const limit = clampToRange(requestedLimit, 1, REPORT_LIST_MAX_LIMIT);
  const limitClamped = limit !== requestedLimit;
  if (opts.passRate && !['all', 'passing', 'failing', 'below-threshold'].includes(opts.passRate)) {
    throw new Error(
      `--pass-rate must be one of: all, passing, failing, below-threshold (got '${opts.passRate}')`
    );
  }
  const list = await apiGet<ReportListResponse>(config, '/api/report/list', {
    project: opts.project,
    search: opts.search,
    tags: opts.tags,
    from: opts.from,
    to: opts.to,
    passRate: opts.passRate,
    limit,
    offset: opts.offset,
  });
  emitJson({
    window: {
      project: opts.project,
      from: opts.from,
      to: opts.to,
      passRate: opts.passRate,
      search: opts.search,
      tags: opts.tags,
    },
    total: list.total,
    appliedLimit: limit,
    limitClamped,
    hasMore: list.total > (opts.offset ?? 0) + list.reports.length,
    reports: list.reports.map((r) => ({
      reportId: r.reportID,
      project: r.project,
      title: r.title,
      displayNumber: r.displayNumber,
      createdAt: r.createdAt,
      reportUrl: r.reportUrl,
      stats: r.stats
        ? {
            total: r.stats.total,
            passed: r.stats.expected,
            failed: r.stats.unexpected,
            flaky: r.stats.flaky,
            skipped: r.stats.skipped,
            ok: r.stats.ok,
          }
        : undefined,
    })),
  });
}

interface ReportCompareOpts {
  limit?: number;
  project?: string;
}

const COMPARE_DEFAULT_PER_BUCKET = 20;

/**
 * `report compare` returns up to 8 diff buckets (newlyFailed, fixed,
 * stillFailing, …). Caps each bucket so a comparison of a 500-test report
 * doesn't dump 500 entries per bucket into the agent context.
 *
 * Either positional accepts the keywords `latest` (most recent report) or
 * `prev` / `previous` (second most recent), resolved server-side. Use
 * --project to scope keyword resolution to a single project.
 */
export async function runReportCompare(
  reportA: string,
  reportB: string,
  opts: ReportCompareOpts
): Promise<void> {
  if (!reportA || !reportB) {
    throw new Error(
      'Usage: pwrs-cli report compare <reportIdA|latest|prev> <reportIdB|latest|prev> [--project <p>] [--limit N]'
    );
  }
  const config = resolveConfig();
  const limit = clampToRange(opts.limit ?? COMPARE_DEFAULT_PER_BUCKET, 1, 100);
  const comparison = await apiGet<ReportCompareResponse>(config, '/api/report/compare', {
    a: reportA,
    b: reportB,
    project: opts.project,
  });

  const trimDiff = (entries: DiffTestEntry[]) =>
    entries.slice(0, limit).map(normalizeEntry) as DiffTestEntry[];

  const trimDurationDeltas = (entries: DurationDeltaEntry[]) =>
    entries.slice(0, limit).map((d) => ({
      testId: d.testId,
      title: d.title,
      filePath: d.filePath,
      project: d.project,
      deltaMs: d.deltaMs,
      deltaPct: d.deltaPct,
    }));

  const slimReport = (r: typeof comparison.reportA) => ({
    reportId: r.reportID,
    title: r.title,
    project: r.project,
    createdAt: r.createdAt,
    reportUrl: r.reportUrl,
  });

  emitJson({
    // Server resolved `latest` / `prev` via reportA.reportID / reportB.reportID.
    reportA: slimReport(comparison.reportA),
    reportB: slimReport(comparison.reportB),
    summary: comparison.summary,
    bucketsTruncated: anyBucketOver(comparison, limit),
    perBucketLimit: limit,
    newlyFailed: trimDiff(comparison.newlyFailed),
    fixed: trimDiff(comparison.fixed),
    stillFailing: trimDiff(comparison.stillFailing),
    flakyToPass: trimDiff(comparison.flakyToPass),
    passToFlaky: trimDiff(comparison.passToFlaky),
    newTests: trimDiff(comparison.newTests),
    removedTests: trimDiff(comparison.removedTests),
    durationDeltas: trimDurationDeltas(comparison.durationDeltas),
  });
}

const RAW_TO_NORMALIZED: Record<string, 'passed' | 'failed' | 'flaky' | 'skipped' | 'unknown'> = {
  pass: 'passed',
  fail: 'failed',
  flaky: 'flaky',
  skipped: 'skipped',
  unknown: 'unknown',
};

function normalizeEntry<T extends DiffTestEntry | DurationDeltaEntry>(entry: T): T {
  return {
    ...entry,
    outcomeA: entry.outcomeA ? RAW_TO_NORMALIZED[entry.outcomeA] : undefined,
    outcomeB: entry.outcomeB ? RAW_TO_NORMALIZED[entry.outcomeB] : undefined,
  };
}

interface ReportResolveOpts {
  project?: string;
}

/**
 * Resolve a `#479`-style displayNumber to the UUID reportId(s) that
 * `report compare` / `report brief` accept. Multiple matches when the same
 * displayNumber exists across projects - pass `--project` to scope.
 */
export async function runReportResolve(
  displayNumber: string,
  opts: ReportResolveOpts
): Promise<void> {
  if (!displayNumber) {
    throw new Error('Usage: pwrs-cli report resolve <displayNumber> [--project <p>]');
  }
  const config = resolveConfig();
  const data = await apiGet<ReportResolveResponse>(config, '/api/cli/report/resolve', {
    displayNumber,
    project: opts.project,
  });
  emitJson(data);
}

interface SummarySubmitOpts {
  summaryFile?: string;
  structuredFile?: string;
  model: string;
  force?: boolean;
}

export async function runReportSummarySubmit(
  reportId: string,
  opts: SummarySubmitOpts
): Promise<void> {
  if (!reportId) {
    throw new Error(
      'Usage: pwrs-cli report summary-submit <reportId> --summary-file <path|-> --model <name> [--structured-file <path|->] [--force]'
    );
  }
  const llmSummary = await readTextInput(opts.summaryFile, { label: 'summary' });
  const llmSummaryStructured = await readJsonInput<unknown>(opts.structuredFile, {
    label: 'structured',
  });
  const config = resolveConfig();
  const data = await apiPost<unknown>(
    config,
    `/api/cli/report/${encodeURIComponent(reportId)}/summary`,
    {
      llmSummary,
      llmSummaryStructured,
      model: opts.model,
      force: opts.force ? true : undefined,
    }
  );
  emitJson(data);
}

function anyBucketOver(c: ReportCompareResponse, limit: number): boolean {
  return (
    c.newlyFailed.length > limit ||
    c.fixed.length > limit ||
    c.stillFailing.length > limit ||
    c.flakyToPass.length > limit ||
    c.passToFlaky.length > limit ||
    c.newTests.length > limit ||
    c.removedTests.length > limit ||
    c.durationDeltas.length > limit
  );
}

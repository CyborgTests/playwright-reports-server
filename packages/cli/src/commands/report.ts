import { apiGet } from '../client.js';
import { resolveConfig } from '../config.js';
import { emitJson } from '../format.js';
import type {
  DiffTestEntry,
  DurationDeltaEntry,
  ReportBrief,
  ReportCompareResponse,
  ReportListResponse,
} from '../types.js';

interface LatestOpts {
  project?: string;
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
    `/api/cli/report/${encodeURIComponent(latest.reportID)}/brief`
  );
  emitJson(brief);
}

export async function runReportBrief(reportId: string): Promise<void> {
  if (!reportId) {
    throw new Error('Usage: pwrs-cli report brief <reportId>');
  }
  const config = resolveConfig();
  const brief = await apiGet<ReportBrief>(
    config,
    `/api/cli/report/${encodeURIComponent(reportId)}/brief`
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
  const limit = clampToRange(opts.limit ?? REPORT_LIST_DEFAULT_LIMIT, 1, REPORT_LIST_MAX_LIMIT);
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
}

const COMPARE_DEFAULT_PER_BUCKET = 20;

/**
 * `report compare` returns up to 8 diff buckets (newlyFailed, fixed,
 * stillFailing, …). Caps each bucket so a comparison of a 500-test report
 * doesn't dump 500 entries per bucket into the agent context.
 */
export async function runReportCompare(
  reportA: string,
  reportB: string,
  opts: ReportCompareOpts
): Promise<void> {
  if (!reportA || !reportB) {
    throw new Error('Usage: pwrs-cli report compare <reportIdA> <reportIdB> [--limit N]');
  }
  const config = resolveConfig();
  const limit = clampToRange(opts.limit ?? COMPARE_DEFAULT_PER_BUCKET, 1, 100);
  const comparison = await apiGet<ReportCompareResponse>(config, '/api/report/compare', {
    a: reportA,
    b: reportB,
  });

  const trim = <T extends DiffTestEntry | DurationDeltaEntry>(entries: T[]) =>
    entries.slice(0, limit);

  emitJson({
    reportA: comparison.reportA,
    reportB: comparison.reportB,
    summary: comparison.summary,
    bucketsTruncated: anyBucketOver(comparison, limit),
    perBucketLimit: limit,
    newlyFailed: trim(comparison.newlyFailed),
    fixed: trim(comparison.fixed),
    stillFailing: trim(comparison.stillFailing),
    flakyToPass: trim(comparison.flakyToPass),
    passToFlaky: trim(comparison.passToFlaky),
    newTests: trim(comparison.newTests),
    removedTests: trim(comparison.removedTests),
    durationDeltas: trim(comparison.durationDeltas),
  });
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

function clampToRange(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

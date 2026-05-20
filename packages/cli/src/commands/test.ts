import { apiGet } from '../client.js';
import { resolveConfig } from '../config.js';
import { emitJson } from '../format.js';
import type { TestBrief, TestSummary } from '../types.js';

interface FindOpts {
  project?: string;
  limit: number;
}

interface BriefOpts {
  project?: string;
  fileId?: string;
}

interface FromFileOpts {
  project?: string;
  limit: number;
}

export async function runTestFind(query: string, opts: FindOpts): Promise<void> {
  if (!query) throw new Error('Usage: pwrs-cli test find <query> [--project <p>] [--limit N]');
  const config = resolveConfig();
  const data = await apiGet<{ data: TestSummary[]; total: number } | TestSummary[]>(
    config,
    '/api/tests',
    {
      search: query,
      project: opts.project,
      limit: opts.limit,
    }
  );
  const tests = Array.isArray(data) ? data : ((data as { data?: TestSummary[] }).data ?? []);
  emitJson({
    matches: tests.slice(0, opts.limit).map((t) => ({
      testId: t.testId,
      fileId: t.fileId,
      project: t.project,
      title: t.title,
      filePath: t.filePath,
      isQuarantined: t.isQuarantined ?? false,
      flakinessScore: Math.round((t.flakinessScore ?? 0) * 10) / 10,
    })),
  });
}

export async function runTestBrief(testId: string, opts: BriefOpts): Promise<void> {
  if (!testId || !opts.fileId || !opts.project) {
    throw new Error('Usage: pwrs-cli test brief <testId> --file-id <fileId> --project <project>');
  }
  const config = resolveConfig();
  const brief = await apiGet<TestBrief>(
    config,
    `/api/cli/test/${encodeURIComponent(opts.fileId)}/${encodeURIComponent(testId)}/brief`,
    { project: opts.project }
  );
  emitJson(brief);
}

export async function runTestFromFile(spec: string, opts: FromFileOpts): Promise<void> {
  if (!spec) {
    throw new Error('Usage: pwrs-cli test from-file <path>[:line] [--project <p>] [--limit N]');
  }
  // `<path>:<line>` is accepted for forward compatibility; the line isn't used
  // yet — the file path is enough to scope candidates.
  const filePath = spec.includes(':') ? (spec.split(':')[0] as string) : spec;
  const basename = filePath.split('/').pop() ?? filePath;

  const config = resolveConfig();
  const data = await apiGet<{ data: TestSummary[]; total: number } | TestSummary[]>(
    config,
    '/api/tests',
    {
      search: basename,
      project: opts.project,
      limit: opts.limit,
    }
  );
  const tests = Array.isArray(data) ? data : ((data as { data?: TestSummary[] }).data ?? []);
  const matches = tests
    .filter((t) => t.filePath?.includes(filePath) || t.filePath?.endsWith(basename))
    .slice(0, opts.limit);
  emitJson({
    matches: matches.map((t) => ({
      testId: t.testId,
      fileId: t.fileId,
      project: t.project,
      title: t.title,
      filePath: t.filePath,
    })),
  });
}

interface SearchOpts {
  project?: string;
  tier?: string;
  status?: string;
  failureCategory?: string;
  sort?: string;
  search?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

const SEARCH_DEFAULT_LIMIT = 20;
const SEARCH_MAX_LIMIT = 100;

/**
 * Open-ended test discovery. Wraps /api/tests with its full filter surface so
 * the agent can answer "what's flaky this week", "what's quarantined",
 * "what's failing with timeouts", "what's the slowest test". Returns a
 * compact roster (no per-run history) — drill into `test brief` once a
 * candidate is identified.
 */
export async function runTestSearch(opts: SearchOpts): Promise<void> {
  const config = resolveConfig();
  const limit = clampToRange(opts.limit ?? SEARCH_DEFAULT_LIMIT, 1, SEARCH_MAX_LIMIT);
  if (opts.status && !['all', 'quarantined', 'not-quarantined'].includes(opts.status)) {
    throw new Error(
      `--status must be one of: all, quarantined, not-quarantined (got '${opts.status}')`
    );
  }
  if (opts.tier) {
    const valid = new Set(['stable', 'flaky', 'critical']);
    const bad = opts.tier
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t && !valid.has(t));
    if (bad.length > 0) {
      throw new Error(
        `--tier values must be one of: stable, flaky, critical (got '${bad.join(',')}')`
      );
    }
  }
  if (opts.sort && opts.sort !== 'slowest') {
    throw new Error(`--sort currently only supports 'slowest' (got '${opts.sort}')`);
  }
  const data = await apiGet<{ data: TestSummary[]; total: number } | TestSummary[]>(
    config,
    '/api/tests',
    {
      project: opts.project,
      tiers: opts.tier,
      status: opts.status,
      failureCategory: opts.failureCategory,
      sort: opts.sort,
      search: opts.search,
      from: opts.from,
      to: opts.to,
      limit,
      offset: opts.offset,
    }
  );
  const tests = Array.isArray(data) ? data : ((data as { data?: TestSummary[] }).data ?? []);
  const total =
    typeof (data as { total?: number }).total === 'number'
      ? (data as { total: number }).total
      : tests.length;
  emitJson({
    window: {
      project: opts.project,
      from: opts.from,
      to: opts.to,
      tier: opts.tier,
      status: opts.status,
      failureCategory: opts.failureCategory,
      sort: opts.sort,
      search: opts.search,
    },
    total,
    matches: tests.slice(0, limit).map((t) => ({
      testId: t.testId,
      fileId: t.fileId,
      project: t.project,
      title: t.title,
      filePath: t.filePath,
      isQuarantined: t.isQuarantined ?? false,
      flakinessScore: Math.round((t.flakinessScore ?? 0) * 10) / 10,
      totalRuns: t.totalRuns,
      lastRunAt: t.lastRunAt,
    })),
  });
}

function clampToRange(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

import { apiGet, apiPost } from '../client.js';
import { resolveConfig } from '../config.js';
import { clampToRange, emitJson } from '../format.js';
import { readTextInput } from '../input.js';
import type { TestAnalysis, TestBrief, TestHistory, TestSummary } from '../types.js';

interface FindOpts {
  project?: string;
  limit: number;
}

interface BriefOpts {
  project?: string;
}

interface HistoryOpts {
  project?: string;
  limit?: number;
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
  const total =
    typeof (data as { total?: number }).total === 'number'
      ? (data as { total: number }).total
      : tests.length;
  const matches = tests.slice(0, opts.limit);
  emitJson({
    total,
    appliedLimit: opts.limit,
    hasMore: total > matches.length,
    matches: matches.map((t) => ({
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

/**
 * `--project` is optional. When omitted, the server resolves the latest
 * `test_runs` row for the testId.
 */
export async function runTestBrief(testId: string, opts: BriefOpts): Promise<void> {
  if (!testId) {
    throw new Error('Usage: pwrs-cli test brief <testId> [--project <p>]');
  }
  const config = resolveConfig();
  const brief = await apiGet<TestBrief>(
    config,
    `/api/cli/test/${encodeURIComponent(testId)}/brief`,
    opts.project ? { project: opts.project } : {}
  );
  emitJson(brief);
}

/**
 * Full persisted LLM analysis markdown for a test. `test brief` returns a
 * regex-split `rootCause` / `fix` view that may miss sections — use this when
 * you want the unmodified document. `--project` optional, same server-side
 * resolution as `test brief`.
 */
export async function runTestAnalysis(testId: string, opts: BriefOpts): Promise<void> {
  if (!testId) {
    throw new Error('Usage: pwrs-cli test analysis <testId> [--project <p>]');
  }
  const config = resolveConfig();
  const analysis = await apiGet<TestAnalysis>(
    config,
    `/api/cli/test/${encodeURIComponent(testId)}/analysis`,
    opts.project ? { project: opts.project } : {}
  );
  emitJson(analysis);
}

interface PromptOpts {
  project?: string;
  reportId: string;
}

interface AnalysisPromptOpts extends PromptOpts {
  taskId?: string;
}

/**
 * Current would-be prompt the analysis queue would feed the LLM for this test
 * right now, plus the typed evidence envelope. Lets an external coding agent
 * pull every signal we have (codeframe, step tree, ARIA snapshot, git/CI
 * context, console/network events, history) without going through the LLM.
 */
export async function runTestFailureContext(testId: string, opts: PromptOpts): Promise<void> {
  if (!testId || !opts.reportId) {
    throw new Error(
      'Usage: pwrs-cli test failure-context <testId> --report-id <id> [--project <p>]'
    );
  }
  const config = resolveConfig();
  const query: Record<string, string | undefined> = { reportId: opts.reportId };
  if (opts.project) query.project = opts.project;
  const data = await apiGet<unknown>(
    config,
    `/api/cli/test/${encodeURIComponent(testId)}/failure-context`,
    query
  );
  emitJson(data);
}

/**
 * Verbatim text of the prompt we sent on the latest completed test_analysis
 * task for this (testId, reportId). Mirrors the in-report widget's "Copy
 * prompt" button. Use `--task-id` to address a specific historical run.
 */
export async function runTestAnalysisPrompt(
  testId: string,
  opts: AnalysisPromptOpts
): Promise<void> {
  if (!testId || !opts.reportId) {
    throw new Error(
      'Usage: pwrs-cli test analysis-prompt <testId> --report-id <id> [--project <p>] [--task-id <id>]'
    );
  }
  const config = resolveConfig();
  const query: Record<string, string | undefined> = { reportId: opts.reportId };
  if (opts.project) query.project = opts.project;
  if (opts.taskId) query.taskId = opts.taskId;
  const data = await apiGet<unknown>(
    config,
    `/api/cli/test/${encodeURIComponent(testId)}/analysis-prompt`,
    query
  );
  emitJson(data);
}

/**
 * Per-run history for a single test. Default 20 most-recent runs (max 50),
 * plus a signatureGroups rollup so the agent can spot "failed the same way 6
 * times, then a new signature appeared" without scanning every entry.
 */
export async function runTestHistory(testId: string, opts: HistoryOpts): Promise<void> {
  if (!testId) {
    throw new Error('Usage: pwrs-cli test history <testId> [--project <p>] [--limit N]');
  }
  const config = resolveConfig();
  const query: Record<string, string | number | undefined> = {};
  if (opts.project) query.project = opts.project;
  if (opts.limit) query.limit = opts.limit;
  const history = await apiGet<TestHistory>(
    config,
    `/api/cli/test/${encodeURIComponent(testId)}/history`,
    query
  );
  emitJson(history);
}

export async function runTestFromFile(spec: string, opts: FromFileOpts): Promise<void> {
  if (!spec) {
    throw new Error('Usage: pwrs-cli test from-file <path>[:line] [--project <p>] [--limit N]');
  }
  // `<path>:<line>` narrows by proximity to the failure location reported by
  // a previous run — useful when an agent has a CI stack frame like
  // `tests/checkout.spec.ts:200`. Without `:line`, every test in the file matches.
  const [pathPart, linePart] = spec.split(':');
  const filePath = pathPart ?? spec;
  const targetLine = linePart ? Number.parseInt(linePart, 10) : Number.NaN;
  const hasTargetLine = Number.isFinite(targetLine) && targetLine > 0;
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
  let candidates = tests.filter(
    (t) => t.filePath?.includes(filePath) || t.filePath?.endsWith(basename)
  );

  // When the agent supplied a line, sort matches by proximity. We fetch briefs
  // in parallel (cluster cache + per-test cache make this safe) and rank by
  // distance to `targetLine`. Tests whose brief fetch fails are reported in
  // `proximityScoring.fetchErrors` so the caller knows the ranking is partial.
  let scoring:
    | {
        evaluated: number;
        ranked: number;
        fetchErrors: string[];
      }
    | undefined;
  if (hasTargetLine && candidates.length > 1) {
    const evaluated = candidates.slice(0, opts.limit * 4);
    const { scored, fetchErrors } = await scoreByFailureLine(config, evaluated, targetLine);
    scoring = { evaluated: evaluated.length, ranked: scored.length, fetchErrors };
    if (scored.length > 0) {
      const distanceById = new Map(scored.map((h) => [h.testId, h.distance]));
      candidates = [...candidates].sort((a, b) => {
        const da = distanceById.get(a.testId) ?? Number.POSITIVE_INFINITY;
        const db = distanceById.get(b.testId) ?? Number.POSITIVE_INFINITY;
        return da - db;
      });
    }
  }
  const matches = candidates.slice(0, opts.limit);
  emitJson({
    targetLine: hasTargetLine ? targetLine : undefined,
    appliedLimit: opts.limit,
    proximityScoring: scoring,
    matches: matches.map((t) => ({
      testId: t.testId,
      fileId: t.fileId,
      project: t.project,
      title: t.title,
      filePath: t.filePath,
    })),
  });
}

/**
 * Best-effort proximity score for matches when `from-file <path>:<line>` is
 * used. Briefs are fetched in parallel (server-side getFailureClusters has a
 * 60s cache, so the heavy lifting is shared). Tests whose brief fetch fails
 * are returned in `fetchErrors` so the caller can surface a "ranking is
 * partial" hint to the agent.
 */
async function scoreByFailureLine(
  config: import('../config.js').ResolvedConfig,
  candidates: TestSummary[],
  targetLine: number
): Promise<{
  scored: Array<{ testId: string; distance: number }>;
  fetchErrors: string[];
}> {
  const settled = await Promise.allSettled(
    candidates.map((t) =>
      apiGet<TestBrief>(config, `/api/cli/test/${encodeURIComponent(t.testId)}/brief`, {
        project: t.project,
      })
    )
  );

  const scored: Array<{ testId: string; distance: number }> = [];
  const fetchErrors: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const t = candidates[i];
    const result = settled[i];
    if (result.status === 'rejected') {
      fetchErrors.push(t.testId);
      continue;
    }
    const line = result.value.latestFailure?.location?.line;
    if (typeof line === 'number') {
      scored.push({ testId: t.testId, distance: Math.abs(line - targetLine) });
    }
  }
  return { scored, fetchErrors };
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
  const requestedLimit = opts.limit ?? SEARCH_DEFAULT_LIMIT;
  const limit = clampToRange(requestedLimit, 1, SEARCH_MAX_LIMIT);
  const limitClamped = limit !== requestedLimit;
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
    appliedLimit: limit,
    limitClamped,
    hasMore: total > tests.slice(0, limit).length,
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

interface AnalysisSubmitOpts {
  reportId: string;
  analysisFile?: string;
  category?: string;
  model: string;
  force?: boolean;
}

export async function runTestAnalysisSubmit(
  testId: string,
  opts: AnalysisSubmitOpts
): Promise<void> {
  if (!testId) {
    throw new Error(
      'Usage: pwrs-cli test analysis-submit <testId> --report-id <id> --analysis-file <path|-> --model <name> [--category <c>] [--force]'
    );
  }
  const analysis = await readTextInput(opts.analysisFile, { label: 'analysis' });
  const config = resolveConfig();
  const data = await apiPost<unknown>(
    config,
    `/api/cli/test/${encodeURIComponent(testId)}/analysis`,
    {
      reportId: opts.reportId,
      analysis,
      category: opts.category,
      model: opts.model,
      force: opts.force ? true : undefined,
    }
  );
  emitJson(data);
}

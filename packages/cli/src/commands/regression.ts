import { apiGet } from '../client.js';
import { resolveConfig } from '../config.js';
import { emitJson } from '../format.js';

interface RegressionListOpts {
  project?: string;
  active?: boolean;
  resolved?: boolean;
  from?: string;
  to?: string;
  sort?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 25;

interface RegressionRow {
  id: string;
  testId: string;
  fileId: string;
  project: string;
  title: string | null;
  filePath: string | null;
  regressedAtReportId: string;
  regressedAtDisplayNumber: number | null;
  regressedAtCreatedAt: string;
  regressedAtCommit: string | null;
  regressedAtCategory: string | null;
  lastGreenReportId: string | null;
  lastGreenDisplayNumber: number | null;
  lastGreenCreatedAt: string | null;
  lastGreenCommit: string | null;
  recoveredAtReportId: string | null;
  recoveredAtCreatedAt: string | null;
  recoveredAtCommit: string | null;
  daysOpen: number;
  failureCount: number;
  flakyCount: number;
  isActive: boolean;
}

interface RegressionListResponse {
  rows: RegressionRow[];
  total: number;
  hasMore: boolean;
}

export async function runRegressionList(opts: RegressionListOpts): Promise<void> {
  if (opts.active && opts.resolved) {
    throw new Error('--active and --resolved are mutually exclusive');
  }
  const validSorts = new Set(['impact', 'recent', 'oldest']);
  if (opts.sort && !validSorts.has(opts.sort)) {
    throw new Error(`--sort must be one of: impact, recent, oldest (got '${opts.sort}')`);
  }
  const config = resolveConfig();
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const response = await apiGet<RegressionListResponse>(config, '/api/cli/regression/list', {
    project: opts.project,
    active: opts.active ? 'true' : undefined,
    resolved: opts.resolved ? 'true' : undefined,
    from: opts.from,
    to: opts.to,
    sort: opts.sort,
    limit,
  });

  emitJson({
    window: { project: opts.project, from: opts.from, to: opts.to },
    sort: opts.sort ?? 'impact',
    appliedLimit: limit,
    total: response.total,
    hasMore: response.hasMore,
    regressions: response.rows,
  });
}

import { apiGet } from '../client.js';
import { resolveConfig } from '../config.js';
import { emitJson } from '../format.js';
import type { AnalyticsResponse } from '../types.js';

interface StatsOpts {
  project?: string;
  from?: string;
  to?: string;
  failedOnly?: boolean;
}

/**
 * Compact projection of /api/analytics for agent consumption: keeps the
 * scalar overview stats and category aggregates, drops the per-run /
 * per-day arrays (a 100-row trend chart blows the context budget for what
 * is usually a digest question).
 */
export async function runStats(opts: StatsOpts): Promise<void> {
  const config = resolveConfig();
  const data = await apiGet<AnalyticsResponse>(config, '/api/analytics', {
    project: opts.project ?? 'all',
    from: opts.from,
    to: opts.to,
    failedOnly: opts.failedOnly ? 'true' : undefined,
  });

  emitJson({
    window: {
      project: opts.project ?? 'all',
      from: opts.from,
      to: opts.to,
      failedOnly: opts.failedOnly ?? false,
    },
    overview: data.overviewStats,
    tests: data.testsSummary,
    failureCategories: data.failureCategories,
    regressions: data.regressions,
    recentRunsCount: data.runHealthMetrics?.length ?? 0,
  });
}

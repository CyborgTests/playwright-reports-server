import { isEnvironmentUnknownFilter } from '@playwright-reports/shared';
import type { SelectQueryBuilder } from 'kysely';
import type { Database } from './kysely.js';

export function applyReportEnvironmentFilter<O>(
  q: SelectQueryBuilder<Database, 'reports', O>,
  environment: string | undefined
): SelectQueryBuilder<Database, 'reports', O> {
  if (!environment || environment === 'all') return q;
  if (isEnvironmentUnknownFilter(environment)) {
    return q.where('environment', 'is', null);
  }
  return q.where('environment', '=', environment);
}

export function applyResultEnvironmentFilter<O>(
  q: SelectQueryBuilder<Database, 'results', O>,
  environment: string | undefined
): SelectQueryBuilder<Database, 'results', O> {
  if (!environment || environment === 'all') return q;
  if (isEnvironmentUnknownFilter(environment)) {
    return q.where('environment', 'is', null);
  }
  return q.where('environment', '=', environment);
}

export function distinctEnvironments(
  db: import('better-sqlite3').Database,
  spec: { entity: 'report' | 'result'; project?: string }
): string[] {
  const table = spec.entity === 'report' ? 'reports' : 'results';

  const rows = spec.project
    ? (db
        .prepare(
          `SELECT DISTINCT environment AS environment
           FROM ${table}
           WHERE project = ? AND environment IS NOT NULL
           ORDER BY environment ASC`
        )
        .all(spec.project) as Array<{ environment: string }>)
    : (db
        .prepare(
          `SELECT DISTINCT environment AS environment
           FROM ${table}
           WHERE environment IS NOT NULL
           ORDER BY environment ASC`
        )
        .all() as Array<{ environment: string }>);

  return rows.map((r) => r.environment).filter(Boolean);
}

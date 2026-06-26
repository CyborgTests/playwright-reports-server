import type { FlakinessTier, TestFilters, TestsSort } from '@playwright-reports/shared';
import { defaultProjectName } from '@/lib/constants';
import { FLAKINESS_TIERS } from './TestFilters';

function parseTiersParam(raw: string | null): FlakinessTier[] | undefined {
  if (!raw) return undefined;
  const tiers = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t): t is FlakinessTier => (FLAKINESS_TIERS as string[]).includes(t));
  return tiers.length > 0 ? tiers : undefined;
}

function parseSortParam(raw: string | null): TestsSort | undefined {
  if (raw === 'slowest' || raw === 'stale' || raw === 'regression-age') return raw;
  return undefined;
}

function parseStatusParam(raw: string | null): TestFilters['status'] {
  if (raw === 'quarantined' || raw === 'not-quarantined') return raw;
  return 'all';
}

export function parseTestFilters(
  searchParams: URLSearchParams,
  project: string | undefined
): TestFilters {
  return {
    project: project ?? defaultProjectName,
    status: parseStatusParam(searchParams.get('status')),
    tiers: parseTiersParam(searchParams.get('tiers')),
    sort: parseSortParam(searchParams.get('sort')),
    failureCategory: searchParams.get('failureCategory') || undefined,
    search: searchParams.get('search') || undefined,
    regressedOnly: searchParams.get('regressedOnly') === '1',
    regressedSince: searchParams.get('regressedSince') || undefined,
    resolvedSince: searchParams.get('resolvedSince') || undefined,
  };
}

export function buildFilterParams(next: TestFilters, current: URLSearchParams): URLSearchParams {
  // Each param's serialized value, or undefined to drop it from the URL.
  const values: Record<string, string | undefined> = {
    status: next.status && next.status !== 'all' ? next.status : undefined,
    tiers: next.tiers?.length ? next.tiers.join(',') : undefined,
    sort: next.sort && next.sort !== 'default' ? next.sort : undefined,
    regressedOnly: next.regressedOnly ? '1' : undefined,
    regressedSince: next.regressedSince || undefined,
    resolvedSince: next.resolvedSince || undefined,
    failureCategory: next.failureCategory || undefined,
    search: next.search || undefined,
  };

  const params = new URLSearchParams(current);
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return params;
}

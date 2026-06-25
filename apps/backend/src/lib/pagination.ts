import type { PaginationResponse } from '@playwright-reports/shared';

const LIMIT_DEFAULT = 25;
const LIMIT_MAX = 100;

function toInt(raw: unknown, fallback: number, min: number): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

// page is 1-based.
export function parsePageQuery(query: unknown): { page: number; limit: number; offset: number } {
  const q = (query ?? {}) as Record<string, unknown>;
  const page = toInt(q.page, 1, 1);
  const limit = Math.min(toInt(q.limit, LIMIT_DEFAULT, 1), LIMIT_MAX);
  return { page, limit, offset: (page - 1) * limit };
}

export function pageResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
): PaginationResponse<T> {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return { data, pagination: { page, limit, total, totalPages, hasMore: page < totalPages } };
}

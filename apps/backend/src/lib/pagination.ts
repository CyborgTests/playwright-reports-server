import type { PaginationResponse } from '@playwright-reports/shared';

export interface Pagination {
  limit: number;
  offset: number;
}

const LIMIT_MAX = 100;
const DEFAULT_LIMIT = 20;

function toInt(raw: unknown, fallback: number, min: number): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

const clampLimit = (raw: unknown): number => Math.min(toInt(raw, DEFAULT_LIMIT, 1), LIMIT_MAX);

// Offset-based listing: `{ limit, offset }` straight from the query object.
export function parseOffsetQuery(query: unknown): Pagination {
  const q = (query ?? {}) as Record<string, unknown>;
  return { limit: clampLimit(q.limit), offset: toInt(q.offset, 0, 0) };
}

// Page-based listing: 1-based `page` resolved to an offset.
export function parsePageQuery(query: unknown): { page: number; limit: number; offset: number } {
  const q = (query ?? {}) as Record<string, unknown>;
  const page = toInt(q.page, 1, 1);
  const limit = clampLimit(q.limit);
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

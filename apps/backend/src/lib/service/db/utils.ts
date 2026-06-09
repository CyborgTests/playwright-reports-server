export function parseJsonColumn<T>(value: string | null | undefined, fallback: T): T {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export type SqlPrimitive = string | number | boolean | null;

export interface WhereFragment {
  sql: string;
  params: SqlPrimitive[];
}

export function buildWhere(fragments: Array<WhereFragment | null | undefined>): {
  sql: string;
  params: SqlPrimitive[];
} {
  const active = fragments.filter((f): f is WhereFragment => !!f && f.sql.trim().length > 0);
  if (active.length === 0) return { sql: '', params: [] };
  return {
    sql: `WHERE ${active.map((f) => `(${f.sql})`).join(' AND ')}`,
    params: active.flatMap((f) => f.params),
  };
}

export function windowClause(
  column: string,
  from: string | undefined,
  to: string | undefined
): WhereFragment | null {
  const parts: string[] = [];
  const params: SqlPrimitive[] = [];
  if (from) {
    parts.push(`${column} >= ?`);
    params.push(from);
  }
  if (to) {
    parts.push(`${column} <= ?`);
    params.push(to);
  }
  if (parts.length === 0) return null;
  return { sql: parts.join(' AND '), params };
}

export interface PaginationInput {
  limit?: number;
  offset?: number;
}

export function paginationClause(input: PaginationInput | undefined): {
  sql: string;
  params: number[];
} {
  if (!input || input.limit === undefined) return { sql: '', params: [] };
  const limit = Math.max(0, Math.floor(input.limit));
  const offset = Math.max(0, Math.floor(input.offset ?? 0));
  return { sql: 'LIMIT ? OFFSET ?', params: [limit, offset] };
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) return [items.slice()];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

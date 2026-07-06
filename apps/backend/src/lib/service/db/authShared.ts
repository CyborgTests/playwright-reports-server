import { getDatabase } from './db.js';
import { getKysely } from './kysely.js';

export function nowISO(): string {
  return new Date().toISOString();
}

// Single SQLite write transaction; the callback must be synchronous (no awaits).
// Spans any auth DAO since they share the one connection.
export function tx<T>(fn: () => T): T {
  return getDatabase().transaction(fn)();
}

type AuthTable = 'users' | 'sessions' | 'api_keys' | 'invites' | 'password_reset_tokens';

export function runUpdate(
  table: AuthTable,
  set: Record<string, string | number | null>,
  id: string
): void {
  const compiled = getKysely().updateTable(table).set(set).where('id', '=', id).compile();
  getDatabase()
    .prepare(compiled.sql)
    .run(...compiled.parameters);
}

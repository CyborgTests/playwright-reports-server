import { getDatabase } from './db.js';
import { getKysely } from './kysely.js';
import { singletonOf } from './singleton.js';

export interface AuditEntry {
  id: string;
  ts: string;
  actor: string | null;
  action: string;
  target: string | null;
  detail: string | null;
}

export interface AuditQueryFilters {
  action?: string;
  actor?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export class AuthAuditDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();

  public insertAudit(row: AuditEntry): void {
    const compiled = this.k.insertInto('auth_audit').values(row).compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public pruneAuditOlderThan(cutoffIso: string): number {
    const compiled = this.k.deleteFrom('auth_audit').where('ts', '<', cutoffIso).compile();
    return this.db.prepare(compiled.sql).run(...compiled.parameters).changes;
  }

  public list(filters: AuditQueryFilters): { rows: AuditEntry[]; total: number } {
    let countQuery = this.k
      .selectFrom('auth_audit')
      .select((eb) => eb.fn.countAll<number>().as('total'));
    if (filters.action) countQuery = countQuery.where('action', '=', filters.action);
    if (filters.actor) countQuery = countQuery.where('actor', '=', filters.actor);
    if (filters.from) countQuery = countQuery.where('ts', '>=', filters.from);
    if (filters.to) countQuery = countQuery.where('ts', '<=', filters.to);
    const countCompiled = countQuery.compile();
    const totalRow = this.db.prepare(countCompiled.sql).get(...countCompiled.parameters) as {
      total: number;
    };

    let listQuery = this.k
      .selectFrom('auth_audit')
      .selectAll()
      .orderBy('ts', 'desc')
      .limit(filters.limit)
      .offset(filters.offset);
    if (filters.action) listQuery = listQuery.where('action', '=', filters.action);
    if (filters.actor) listQuery = listQuery.where('actor', '=', filters.actor);
    if (filters.from) listQuery = listQuery.where('ts', '>=', filters.from);
    if (filters.to) listQuery = listQuery.where('ts', '<=', filters.to);
    const listCompiled = listQuery.compile();
    const rows = this.db.prepare(listCompiled.sql).all(...listCompiled.parameters) as AuditEntry[];

    return { rows, total: totalRow.total };
  }
}

export const authAuditDb = singletonOf('authAudit', () => new AuthAuditDatabase());

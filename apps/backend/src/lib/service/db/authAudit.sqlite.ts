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
}

export const authAuditDb = singletonOf('authAudit', () => new AuthAuditDatabase());

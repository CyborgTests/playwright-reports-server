import { runUpdate } from './authShared.js';
import { getDatabase } from './db.js';
import { getKysely } from './kysely.js';
import { singletonOf } from './singleton.js';

export interface SessionRecord {
  id: string;
  tokenHash: string;
  userId: string;
  role: string;
  createdAt: string;
  expiresAt: string;
  idleExpiresAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  ip: string | null;
}

export class SessionsDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();

  public insertSession(row: SessionRecord): void {
    const compiled = this.k.insertInto('sessions').values(row).compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public getSessionByTokenHash(tokenHash: string): SessionRecord | undefined {
    const compiled = this.k
      .selectFrom('sessions')
      .selectAll()
      .where('tokenHash', '=', tokenHash)
      .compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as SessionRecord | undefined;
  }

  public refreshSession(id: string, lastSeenAt: string, idleExpiresAt: string): void {
    runUpdate('sessions', { lastSeenAt, idleExpiresAt }, id);
  }

  public deleteSession(id: string): void {
    const compiled = this.k.deleteFrom('sessions').where('id', '=', id).compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public deleteSessionByTokenHash(tokenHash: string): void {
    const compiled = this.k.deleteFrom('sessions').where('tokenHash', '=', tokenHash).compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public deleteSessionsByUser(userId: string): number {
    const compiled = this.k.deleteFrom('sessions').where('userId', '=', userId).compile();
    return this.db.prepare(compiled.sql).run(...compiled.parameters).changes;
  }

  public pruneExpiredSessions(nowIso: string): number {
    const compiled = this.k
      .deleteFrom('sessions')
      .where((eb) => eb.or([eb('expiresAt', '<', nowIso), eb('idleExpiresAt', '<', nowIso)]))
      .compile();
    return this.db.prepare(compiled.sql).run(...compiled.parameters).changes;
  }
}

export const sessionsDb = singletonOf('sessions', () => new SessionsDatabase());

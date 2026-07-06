import { runUpdate } from './authShared.js';
import { getDatabase } from './db.js';
import { getKysely } from './kysely.js';
import { singletonOf } from './singleton.js';

export interface ResetTokenRecord {
  id: string;
  tokenHash: string;
  userId: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

export class ResetTokensDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();

  public insertResetToken(row: ResetTokenRecord): void {
    const compiled = this.k.insertInto('password_reset_tokens').values(row).compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public getValidResetToken(tokenHash: string, nowIso: string): ResetTokenRecord | undefined {
    const compiled = this.k
      .selectFrom('password_reset_tokens')
      .selectAll()
      .where('tokenHash', '=', tokenHash)
      .where('usedAt', 'is', null)
      .where('expiresAt', '>=', nowIso)
      .compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | ResetTokenRecord
      | undefined;
  }

  public markResetTokenUsed(id: string, usedAt: string): void {
    runUpdate('password_reset_tokens', { usedAt }, id);
  }

  public pruneResetTokens(nowIso: string): number {
    const compiled = this.k
      .deleteFrom('password_reset_tokens')
      .where((eb) => eb.or([eb('usedAt', 'is not', null), eb('expiresAt', '<', nowIso)]))
      .compile();
    return this.db.prepare(compiled.sql).run(...compiled.parameters).changes;
  }
}

export const resetTokensDb = singletonOf('resetTokens', () => new ResetTokensDatabase());

import type { OAuthProviderId } from '@playwright-reports/shared';
import { nowISO } from './authShared.js';
import { getDatabase } from './db.js';
import { getKysely } from './kysely.js';
import { singletonOf } from './singleton.js';

export interface UserIdentityRecord {
  id: string;
  userId: string;
  provider: OAuthProviderId;
  externalId: string;
  email: string | null;
  emailVerified: number;
  displayName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface NewUserIdentity {
  id: string;
  userId: string;
  provider: OAuthProviderId;
  externalId: string;
  email?: string | null;
  emailVerified?: boolean;
  displayName?: string | null;
}

export class UserIdentitiesDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();

  public findByProviderExternalId(
    provider: OAuthProviderId,
    externalId: string
  ): UserIdentityRecord | undefined {
    const compiled = this.k
      .selectFrom('user_identities')
      .selectAll()
      .where('provider', '=', provider)
      .where('externalId', '=', externalId)
      .compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | UserIdentityRecord
      | undefined;
  }

  public listByUserId(userId: string): UserIdentityRecord[] {
    const compiled = this.k
      .selectFrom('user_identities')
      .selectAll()
      .where('userId', '=', userId)
      .orderBy('createdAt', 'asc')
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as UserIdentityRecord[];
  }

  public linkIdentity(identity: NewUserIdentity): void {
    const del = this.k
      .deleteFrom('user_identities')
      .where('userId', '=', identity.userId)
      .where('provider', '=', identity.provider)
      .compile();
    this.db.prepare(del.sql).run(...del.parameters);
    const compiled = this.k
      .insertInto('user_identities')
      .values({
        id: identity.id,
        userId: identity.userId,
        provider: identity.provider,
        externalId: identity.externalId,
        email: identity.email ?? null,
        emailVerified: identity.emailVerified ? 1 : 0,
        displayName: identity.displayName ?? null,
        createdAt: nowISO(),
        lastLoginAt: nowISO(),
      })
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public unlinkIdentity(userId: string, provider: OAuthProviderId): void {
    const compiled = this.k
      .deleteFrom('user_identities')
      .where('userId', '=', userId)
      .where('provider', '=', provider)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public touchLastLogin(id: string): void {
    const compiled = this.k
      .updateTable('user_identities')
      .set({ lastLoginAt: nowISO() })
      .where('id', '=', id)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }
}

export const userIdentitiesDb = singletonOf('userIdentities', () => new UserIdentitiesDatabase());

import { runUpdate } from './authShared.js';
import { getDatabase } from './db.js';
import { getKysely } from './kysely.js';
import { singletonOf } from './singleton.js';

export interface ApiKeyRecord {
  id: string;
  keyHash: string;
  label: string;
  scopes: string;
  capability: 'read' | 'content';
  ownerUserId: string | null;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export class ApiKeysDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();

  public insertApiKey(row: ApiKeyRecord): void {
    const compiled = this.k.insertInto('api_keys').values(row).compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public getApiKeyByHash(keyHash: string): ApiKeyRecord | undefined {
    const compiled = this.k
      .selectFrom('api_keys')
      .selectAll()
      .where('keyHash', '=', keyHash)
      .compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as ApiKeyRecord | undefined;
  }

  public getApiKeyById(id: string): ApiKeyRecord | undefined {
    const compiled = this.k.selectFrom('api_keys').selectAll().where('id', '=', id).compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as ApiKeyRecord | undefined;
  }

  public touchApiKey(id: string, lastUsedAt: string): void {
    runUpdate('api_keys', { lastUsedAt }, id);
  }

  public revokeApiKey(id: string, revokedAt: string): void {
    runUpdate('api_keys', { revokedAt }, id);
  }

  public listApiKeysByOwner(ownerUserId: string): ApiKeyRecord[] {
    const compiled = this.k
      .selectFrom('api_keys')
      .selectAll()
      .where('ownerUserId', '=', ownerUserId)
      .orderBy('createdAt', 'asc')
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as ApiKeyRecord[];
  }

  public listAllApiKeysPaged(limit: number, offset: number): ApiKeyRecord[] {
    const compiled = this.k
      .selectFrom('api_keys')
      .selectAll()
      .orderBy('createdAt', 'asc')
      .limit(limit)
      .offset(offset)
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as ApiKeyRecord[];
  }

  public countApiKeysByOwner(ownerUserId: string): number {
    const compiled = this.k
      .selectFrom('api_keys')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('ownerUserId', '=', ownerUserId)
      .compile();
    return Number((this.db.prepare(compiled.sql).get(...compiled.parameters) as { n: number }).n);
  }

  public listApiKeysByOwnerPaged(
    ownerUserId: string,
    limit: number,
    offset: number
  ): ApiKeyRecord[] {
    const compiled = this.k
      .selectFrom('api_keys')
      .selectAll()
      .where('ownerUserId', '=', ownerUserId)
      .orderBy('createdAt', 'asc')
      .limit(limit)
      .offset(offset)
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as ApiKeyRecord[];
  }

  public countApiKeys(): number {
    const compiled = this.k
      .selectFrom('api_keys')
      .select((eb) => eb.fn.countAll().as('n'))
      .compile();
    return Number((this.db.prepare(compiled.sql).get(...compiled.parameters) as { n: number }).n);
  }
}

export const apiKeysDb = singletonOf('apiKeys', () => new ApiKeysDatabase());

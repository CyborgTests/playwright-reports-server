import { randomUUID } from 'node:crypto';
import { KEY_SCOPES, type KeyCapability, type KeyScope } from '@playwright-reports/shared';
import { apiKeysDb, usersDb } from '../service/db/index.js';
import { generateApiKey, hashToken } from './tokens.js';

// Scope/capability axes live in the shared access module (single source of truth).
export type AuthScope = KeyScope;
export type AuthCapability = KeyCapability;

const ALL_SCOPES: readonly AuthScope[] = Object.values(KEY_SCOPES);
// Throttle last_used_at writes off the hot CI-upload path (mirrors session refresh).
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

export interface MintApiKeyInput {
  label: string;
  scopes: AuthScope[];
  capability: AuthCapability;
  ownerUserId: string | null; // null = service key (survives owner deletion)
  createdBy: string | null;
  expiresAt?: string | null;
}

export interface MintedApiKey {
  id: string;
  key: string; // plaintext — shown to the caller once, never stored
}

export function mintApiKey(input: MintApiKeyInput): MintedApiKey {
  const key = generateApiKey();
  const id = randomUUID();
  apiKeysDb.insertApiKey({
    id,
    keyHash: hashToken(key),
    label: input.label,
    scopes: JSON.stringify(input.scopes),
    capability: input.capability,
    ownerUserId: input.ownerUserId,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
    expiresAt: input.expiresAt ?? null,
    lastUsedAt: null,
    revokedAt: null,
  });
  return { id, key };
}

export interface ResolvedApiKey {
  id: string;
  scopes: AuthScope[];
  capability: AuthCapability;
  ownerUserId: string | null;
}

export function resolveApiKey(presented: string): ResolvedApiKey | null {
  const row = apiKeysDb.getApiKeyByHash(hashToken(presented));
  if (!row || row.revokedAt) return null;

  const now = Date.now();
  if (row.expiresAt && now > Date.parse(row.expiresAt)) return null;

  // Personal keys die with a disabled/deleted owner; service keys (null owner) don't.
  if (row.ownerUserId) {
    const owner = usersDb.getUserById(row.ownerUserId);
    if (!owner || owner.disabled) return null;
  }

  if (!row.lastUsedAt || now - Date.parse(row.lastUsedAt) > LAST_USED_THROTTLE_MS) {
    apiKeysDb.touchApiKey(row.id, new Date(now).toISOString());
  }

  return {
    id: row.id,
    scopes: parseScopes(row.scopes),
    capability: row.capability,
    ownerUserId: row.ownerUserId,
  };
}

export function parseScopes(json: string): AuthScope[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is AuthScope => ALL_SCOPES.includes(s as AuthScope));
  } catch {
    return [];
  }
}

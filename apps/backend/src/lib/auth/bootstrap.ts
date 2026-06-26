import { OAUTH_PROVIDER_IDS } from '@playwright-reports/shared';
import { env } from '../../config/env.js';
import { apiKeysDb, ROOT_USER_ID, siteConfigDb, usersDb } from '../service/db/index.js';
import { hashPassword } from './password.js';
import { AUTH_ENABLED } from './resolve.js';
import { hashToken } from './tokens.js';

const SEED_KEY_LABEL = 'legacy API_TOKEN (deprecated — rotate)';

// Runs once at boot, after migrations. In open mode it only logs a warning and
// touches nothing else.
export async function initAuthBootstrap(): Promise<void> {
  if (!AUTH_ENABLED) {
    console.warn(
      '[auth] API_TOKEN is not set — auth is DISABLED (open mode). All endpoints are publicly accessible.'
    );
    return;
  }
  await reconcileRootUser();
  await seedApiKeyFromToken();
  warnOnMisconfiguredOAuth();
}

function warnOnMisconfiguredOAuth(): void {
  const cfg = siteConfigDb.get();
  const oauth = cfg.oauth;
  if (!oauth) return;
  const baseUrl = (cfg.serverBaseUrl ?? '').trim();
  for (const id of OAUTH_PROVIDER_IDS) {
    const p = oauth[id];
    if (!p?.enabled) continue;
    const issues: string[] = [];
    if (!p.clientId) issues.push('clientId');
    if (!p.clientSecret) issues.push('clientSecret');
    if (id === 'oidc' && !p.issuerUrl) issues.push('issuerUrl');
    if (!baseUrl) issues.push('serverBaseUrl (needed to build the redirect URI)');
    if (issues.length > 0) {
      console.warn(`[auth] OAuth provider "${id}" is enabled but missing: ${issues.join(', ')}`);
    }
  }
}

// Reserved break-glass admin row, driven entirely by ROOT_USERNAME/ROOT_PASSWORD.
async function reconcileRootUser(): Promise<void> {
  const username = env.ROOT_USERNAME;
  const password = env.ROOT_PASSWORD;

  if (!username || !password) {
    usersDb.deleteRootUser(); // ROOT_* unset → no break-glass login
    return;
  }

  const collision = usersDb.getUserByUsername(username);
  if (collision && collision.id !== ROOT_USER_ID) {
    console.error(
      `[auth] ROOT_USERNAME "${username}" collides with an existing user — break-glass login is DISABLED until resolved.`
    );
    return;
  }

  usersDb.upsertRootUser(username, await hashPassword(password));
  console.log('[auth] break-glass root account is active (ROOT_USERNAME/ROOT_PASSWORD set)');
}

// One-time seed so existing reporters/CLIs keep working post-upgrade: a service
// key whose secret equals API_TOKEN. Idempotent — only when there is no admin and
// no key yet (so an enabled→open→enabled toggle never re-mints).
async function seedApiKeyFromToken(): Promise<void> {
  const token = env.API_TOKEN;
  if (!token) return;
  if (usersDb.hasAnyAdmin() || apiKeysDb.countApiKeys() > 0) return;

  const now = new Date().toISOString();
  apiKeysDb.insertApiKey({
    id: 'seed-api-token',
    keyHash: hashToken(token),
    label: SEED_KEY_LABEL,
    scopes: JSON.stringify(['upload', 'cli']),
    capability: 'content',
    ownerUserId: null,
    createdBy: 'system',
    createdAt: now,
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
  });
  console.warn(
    '[auth] seeded a deprecated service API key equal to API_TOKEN so existing CI keeps working. Revoke it after issuing real keys.'
  );
}

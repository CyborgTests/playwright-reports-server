import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Opaque-token primitives shared by sessions, API keys, invites and reset tokens.
// Secrets are generated with 256 bits of entropy and only ever stored as SHA-256
// hashes; the plaintext is shown to the caller once and never persisted.

const TOKEN_BYTES = 32;
const API_KEY_PREFIX = 'pwrs_';

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function generateApiKey(): string {
  return API_KEY_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Constant-time string equality. Both sides are SHA-256'd first so the comparison
// is fixed-width regardless of input length (no length leak), and timing-safe.
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const CIPHER_PREFIX = 'enc:v1:';

function getKey(): Buffer {
  // AES-256 wants exactly 32 bytes - derive from AUTH_SECRET with SHA-256.
  // If AUTH_SECRET isn't set we use a fixed development key so the feature
  // still works locally; tokens stored that way are only as safe as the DB file.
  const secret = env.AUTH_SECRET ?? 'playwright-reports-server-default-dev-key';
  return createHash('sha256').update(secret).digest();
}

export function encryptToken(plain: string): string {
  if (!plain) return '';
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphered = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return CIPHER_PREFIX + Buffer.concat([iv, tag, ciphered]).toString('base64');
}

export function decryptToken(stored: string | null | undefined): string | undefined {
  if (!stored) return undefined;
  if (!stored.startsWith(CIPHER_PREFIX)) {
    return stored;
  }
  const key = getKey();
  const raw = Buffer.from(stored.slice(CIPHER_PREFIX.length), 'base64');
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

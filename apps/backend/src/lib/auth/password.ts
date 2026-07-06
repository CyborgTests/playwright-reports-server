import {
  type BinaryLike,
  randomBytes,
  type ScryptOptions,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: ScryptOptions
) => Promise<Buffer>;

const DEFAULT_PARAMS = { N: 32768, r: 8, p: 1 } as const;
const KEYLEN = 32;
const SALT_BYTES = 16;

// Node requires maxmem > 128 * N * r; give generous headroom.
function memFor(N: number, r: number): number {
  return 128 * N * r * 2;
}

function derive(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return scryptAsync(password, salt, KEYLEN, { N, r, p, maxmem: memFor(N, r) });
}

// Versioned, self-describing encoding so params can change without breaking old
// hashes: scrypt$N$r$p$saltB64url$hashB64url
export async function hashPassword(password: string): Promise<string> {
  const { N, r, p } = DEFAULT_PARAMS;
  const salt = randomBytes(SALT_BYTES);
  const dk = await derive(password, salt, N, r, p);
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${dk.toString('base64url')}`;
}

export async function verifyPassword(
  password: string,
  stored: string | null | undefined
): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (
    !Number.isInteger(N) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    salt.length === 0 ||
    expected.length === 0
  ) {
    return false;
  }

  const dk = await derive(password, salt, N, r, p);
  return dk.length === expected.length && timingSafeEqual(dk, expected);
}

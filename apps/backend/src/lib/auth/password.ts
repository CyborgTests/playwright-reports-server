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

// scrypt is intentionally memory-hard. Defaults: ~32 MiB per hash (128 * N * r).
// Hashing runs behind a semaphore so a burst of logins can't pin every core or
// exhaust memory (we never use the synchronous variant, which would block the loop).
const DEFAULT_PARAMS = { N: 32768, r: 8, p: 1 } as const;
const KEYLEN = 32;
const SALT_BYTES = 16;
const MAX_CONCURRENT_HASHES = 4;

function memFor(N: number, r: number): number {
  // Node requires maxmem > 128 * N * r; give generous headroom.
  return 128 * N * r * 2;
}

// Correct counting semaphore: a released permit is handed directly to the next
// waiter (never re-incremented while a waiter exists), so it can't over-admit.
function createSemaphore(max: number) {
  let permits = max;
  const waiters: Array<() => void> = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (permits > 0) {
      permits -= 1;
    } else {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    try {
      return await fn();
    } finally {
      const next = waiters.shift();
      if (next) next();
      else permits += 1;
    }
  };
}

const withHashSlot = createSemaphore(MAX_CONCURRENT_HASHES);

function derive(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return withHashSlot(() => scryptAsync(password, salt, KEYLEN, { N, r, p, maxmem: memFor(N, r) }));
}

// Versioned, self-describing encoding so params can change without breaking old
// hashes: scrypt$N$r$p$saltB64url$hashB64url
export async function hashPassword(password: string): Promise<string> {
  const { N, r, p } = DEFAULT_PARAMS;
  const salt = randomBytes(SALT_BYTES);
  const dk = await derive(password, salt, N, r, p);
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${dk.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
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

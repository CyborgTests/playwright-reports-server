import { gunzipSync, gzipSync } from 'node:zlib';

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/** Encode a failure_details JSON string for storage. Returns a gzip-compressed
 *  Buffer (written as a BLOB by better-sqlite3) or null when the input is
 *  empty. */
export function encodeFailureDetails(json: string | null | undefined): Buffer | null {
  if (!json) return null;
  return gzipSync(json);
}

/** Decode a failure_details value back to its JSON string. */
export function decodeFailureDetails(
  value: Buffer | Uint8Array | string | null | undefined
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value || null;
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (buf.length >= 2 && buf[0] === GZIP_MAGIC_0 && buf[1] === GZIP_MAGIC_1) {
    return gunzipSync(buf).toString('utf8');
  }
  return buf.toString('utf8') || null;
}

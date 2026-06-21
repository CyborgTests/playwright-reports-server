import path from 'node:path';
import { type Readable, Transform, type Writable } from 'node:stream';

/** Forks a source stream into two writable destinations with coordinated
 *  backpressure. The Transform `callback()` is only invoked after BOTH
 *  destinations have accepted the chunk (or one has signalled `drain`), so
 *  the source paces to whichever sink is slower instead of letting one
 *  sink's buffer grow unbounded when the other is fast.
 *
 *  Use case: forking a multipart upload into a local cache write + a remote
 *  upload - without this, slow S3 + fast disk lets the disk drain ahead and
 *  the remote upload backs up in memory (or vice versa).
 */
export class CoordinatedTee extends Transform {
  constructor(
    private readonly a: Writable,
    private readonly b: Writable,
    options: { highWaterMark?: number } = {}
  ) {
    super({ highWaterMark: options.highWaterMark });
    a.on('error', (err) => this.destroy(err));
    b.on('error', (err) => this.destroy(err));
  }

  override _transform(
    chunk: Buffer,
    _encoding: string,
    callback: (err?: Error | null) => void
  ): void {
    let pending = 2;
    let firstError: Error | null = null;
    const done = (err?: Error | null): void => {
      if (err && !firstError) firstError = err;
      pending -= 1;
      if (pending === 0) callback(firstError);
    };
    const writeTo = (sink: Writable): void => {
      if (sink.write(chunk)) {
        done();
      } else {
        sink.once('drain', () => done());
      }
    };
    writeTo(this.a);
    writeTo(this.b);
  }

  override _flush(callback: (err?: Error | null) => void): void {
    let pending = 2;
    const done = (): void => {
      pending -= 1;
      if (pending === 0) callback();
    };
    this.a.end(done);
    this.b.end(done);
  }
}

/** Reject zip entries whose path would escape the target directory
 *  (zip-slip). `entryPath` is the path string as it appears in the zip;
 *  returns the normalized POSIX-relative form on success or throws on any
 *  attempt to traverse outside the target. The returned value should be
 *  used in place of the raw `entry.path` when constructing the target
 *  filesystem path or remote object key. */
export function safeZipEntryPath(entryPath: string): string {
  if (!entryPath || entryPath.length === 0) {
    throw new Error('zip entry has empty path');
  }
  // Normalize separators and reject any embedded NUL.
  if (entryPath.includes('\0')) {
    throw new Error(`zip entry contains NUL byte: ${entryPath}`);
  }
  const normalized = path.posix.normalize(entryPath.replace(/\\/g, '/'));
  if (normalized.startsWith('/')) {
    throw new Error(`zip entry uses absolute path: ${entryPath}`);
  }
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`zip entry traverses parent directory: ${entryPath}`);
  }
  // Windows drive letters (`C:\foo` → `C:/foo` after slash conversion).
  if (/^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`zip entry uses drive-letter path: ${entryPath}`);
  }
  return normalized;
}

/** Drain a Readable into a string. Used only on paths that must inspect /
 *  rewrite the entire payload before sending (e.g. HTML LLM-button injection
 *  on Playwright's index.html). Caps the in-memory size so a malicious or
 *  corrupt blob can't OOM the server. */
export async function streamToString(
  stream: Readable,
  maxBytes = 32 * 1024 * 1024
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      stream.destroy();
      throw new Error(`streamToString: payload exceeds ${maxBytes} bytes`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

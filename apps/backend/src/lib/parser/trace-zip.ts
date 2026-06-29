import * as readline from 'node:readline';
import { Open } from 'unzipper';
import { reportObjectKey } from '../storage/constants.js';
import { storage } from '../storage/index.js';

export type TraceZip = Awaited<ReturnType<typeof Open.buffer>>;
export type TraceFile = TraceZip['files'][number];

// `storagePath` points legacy reports at their in-place `{project}/{id}` prefix; reading via
// the storage adapter also resolves s3/azure reports whose local copy was cleaned up.
export async function openTraceZip(
  reportId: string,
  tracePath: string,
  storagePath?: string | null
): Promise<TraceZip | null> {
  try {
    const zipBuffer = await storage.readToBuffer(reportObjectKey(reportId, storagePath, tracePath));
    if (!zipBuffer) return null;
    return await Open.buffer(zipBuffer);
  } catch (error) {
    console.warn(
      `[trace-zip] failed to open ${tracePath}: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

export async function* readTraceLines(file: TraceFile): AsyncGenerator<string> {
  const rl = readline.createInterface({
    input: file.stream(),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  try {
    for await (const line of rl) yield line;
  } finally {
    rl.close();
  }
}

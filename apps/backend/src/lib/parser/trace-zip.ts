import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { Open } from 'unzipper';
import { REPORTS_FOLDER } from '../storage/constants.js';

export type TraceZip = Awaited<ReturnType<typeof Open.buffer>>;
export type TraceFile = TraceZip['files'][number];

export async function openTraceZip(reportId: string, tracePath: string): Promise<TraceZip | null> {
  try {
    const zipBuffer = await fs.readFile(path.join(REPORTS_FOLDER, reportId, tracePath));
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

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Open } from 'unzipper';
import { REPORTS_FOLDER } from '../storage/constants.js';

export type TraceZip = Awaited<ReturnType<typeof Open.buffer>>;

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

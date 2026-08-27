import fs from 'node:fs/promises';
import path from 'node:path';
import { serveReportRoute } from '../constants.js';
import { parse } from '../parser/index.js';
import { processWithConcurrency } from '../utils/semaphore.js';
import { withError } from '../withError.js';
import { DATA_FOLDER, DATA_PATH, reportPrefix } from './constants.js';
import { bytesToString } from './format.js';
import type { ReportPath, ReportUploadMetadata, StorageEntry } from './types.js';

// Remote keys must use forward slashes regardless of host OS, so the remote key
// is built with `path.posix.join` while the local path uses the platform
// separator. Leading slashes on the stored config path are stripped so we don't
// produce an absolute path that escapes DATA_FOLDER.
export function resolveBrandingAssetPaths(relativePath: string): {
  localPath: string;
  remoteKey: string;
} {
  const safeRelative = path.normalize(relativePath).replace(/^[/\\]+/, '');
  return {
    localPath: path.join(DATA_FOLDER, safeRelative),
    remoteKey: path.posix.join(DATA_PATH, safeRelative.split(path.sep).join('/')),
  };
}

export async function parseRemoteReportMetadata(
  reportId: string,
  reportPath: string,
  metadata?: ReportUploadMetadata,
  htmlContent?: string,
  sizeBytes?: number
): Promise<ReportUploadMetadata> {
  const html = htmlContent ?? (await fs.readFile(path.join(reportPath, 'index.html'), 'utf-8'));

  const info = await parse(html as string);

  const content = Object.assign(
    info,
    {
      reportID: reportId,
      createdAt: info.startTime ? new Date(info.startTime).toISOString() : new Date().toISOString(),
      reportUrl: `${serveReportRoute}/${reportId}/index.html`,
      project: '',
    },
    sizeBytes !== undefined ? { sizeBytes, size: bytesToString(sizeBytes) } : {},
    metadata ?? {}
  );

  if (metadata?.displayNumber) {
    content.displayNumber = metadata.displayNumber;
  }

  return content;
}

export async function deleteReportsByPrefix(
  reports: ReportPath[],
  label: string,
  listEntries: (prefix: string) => Promise<StorageEntry[]>,
  clear: (keys: string[]) => Promise<unknown>
): Promise<string[]> {
  const outcomes = await processWithConcurrency(reports, 10, async (report) => {
    const entries = await listEntries(reportPrefix(report.reportID, report.storagePath));
    if (entries.length === 0) {
      console.warn(`[${label}] report ${report.reportID} listed no objects, not confirming`);
      return null;
    }
    const { error } = await withError(clear(entries.map((entry) => entry.key)));
    if (error) {
      console.warn(`[${label}] failed to delete report ${report.reportID}: ${error.message}`);
      return null;
    }
    return report.reportID;
  });
  return outcomes.filter((id): id is string => id !== null);
}

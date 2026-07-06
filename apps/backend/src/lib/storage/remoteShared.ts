import fs from 'node:fs/promises';
import path from 'node:path';
import { serveReportRoute } from '../constants.js';
import { parse } from '../parser/index.js';
import { DATA_FOLDER, DATA_PATH } from './constants.js';
import { bytesToString } from './format.js';
import type { ReportUploadMetadata } from './types.js';

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
  // Optionally provide the file's content directly (when it lives remotely, not on disk).
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

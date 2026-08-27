import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AttachmentCleanupKind } from '@playwright-reports/shared';
import getFolderSize from 'get-folder-size';
import { Open } from 'unzipper';
import { env } from '../../config/env.js';
import { serveReportRoute } from '../constants.js';
import { parse } from '../parser/index.js';
import { generatePlaywrightReport } from '../pw.js';
import { processWithConcurrency, Semaphore } from '../utils/semaphore.js';
import { withError } from '../withError.js';
import { collectAttachments, deleteEntries, summarizeAttachments } from './attachments.js';
import {
  CWD,
  DATA_FOLDER,
  DEFAULT_STREAM_CHUNK_SIZE,
  REPORTS_FOLDER,
  RESULTS_FOLDER,
  TMP_FOLDER,
} from './constants.js';
import { createDirectory } from './folders.js';
import { bytesToString } from './format.js';
import { safeZipEntryPath } from './streamUtils.js';
import type {
  AttachmentDeleteResult,
  AttachmentSizes,
  ByteRange,
  ReadFileResult,
  ReportHistory,
  ReportPath,
  ReportUploadMetadata,
  Storage,
  StorageEntry,
} from './types.js';
import { resolveFileRange, unsatisfiableRangeResult } from './types.js';

async function createDirectoriesIfMissing() {
  await createDirectory(RESULTS_FOLDER);
  await createDirectory(REPORTS_FOLDER);
  await createDirectory(TMP_FOLDER);
}

async function readFile(
  targetPath: string,
  _contentType: string | null,
  range?: ByteRange
): Promise<ReadFileResult | null> {
  const fullPath = path.join(REPORTS_FOLDER, targetPath);
  const { result: stat, error: statErr } = await withError(fs.stat(fullPath));
  if (statErr || !stat?.isFile()) return null;
  const total = stat.size;

  if (range) {
    const resolved = resolveFileRange(total, range);
    if (resolved.contentLength <= 0) {
      // Unsatisfiable range (e.g. start past EOF) — empty stream so the caller
      // can respond 416 Range Not Satisfiable.
      return unsatisfiableRangeResult(resolved, total);
    }
    return {
      body: createReadStream(fullPath, { start: resolved.start, end: resolved.end }),
      size: resolved.contentLength,
      totalSize: total,
      contentRange: { start: resolved.start, end: resolved.end, total },
    };
  }

  return { body: createReadStream(fullPath), size: total, totalSize: total };
}

async function pathIsFile(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

function resolveReportFolder(reportId: string, storagePath?: string | null): string | null {
  const resolved = path.resolve(REPORTS_FOLDER, storagePath || reportId);
  return resolved.startsWith(REPORTS_FOLDER + path.sep) ? resolved : null;
}

async function reportExists(reportId: string, storagePath?: string | null): Promise<boolean> {
  const folder = resolveReportFolder(reportId, storagePath);
  return folder ? pathIsFile(path.join(folder, 'index.html')) : false;
}

async function resultExists(resultId: string): Promise<boolean> {
  return pathIsFile(path.join(RESULTS_FOLDER, `${resultId}.zip`));
}

async function deleteResults(resultsIds: string[]) {
  await Promise.allSettled(resultsIds.map((id) => deleteResult(id)));
}

async function deleteResult(resultId: string) {
  const resultPath = path.join(RESULTS_FOLDER, resultId);

  await withError(fs.unlink(`${resultPath}.zip`));
}

async function deleteReports(reports: ReportPath[]): Promise<string[]> {
  const outcomes = await processWithConcurrency(reports, 10, async (report) => {
    const { error } = await withError(deleteReport(report.reportID, report.storagePath));
    if (error) {
      console.warn(`[fs] failed to delete report ${report.reportID}:`, error);
      return null;
    }
    return report.reportID;
  });
  return outcomes.filter((id): id is string => id !== null);
}

async function deleteReport(reportId: string, storagePath?: string | null) {
  const reportPath = resolveReportFolder(reportId, storagePath);
  if (!reportPath) {
    throw new Error(`report ${reportId} resolves outside the reports root, refusing to delete`);
  }

  await fs.rm(reportPath, { recursive: true, force: true });
}

async function saveResult(filename: string, stream: PassThrough) {
  await createDirectoriesIfMissing();
  const resultPath = path.join(RESULTS_FOLDER, filename);

  const writeable = createWriteStream(resultPath, {
    encoding: 'binary',
    highWaterMark: DEFAULT_STREAM_CHUNK_SIZE,
  });

  const { error: writeStreamError } = await withError(pipeline(stream, writeable));

  if (writeStreamError) {
    throw new Error(`failed stream pipeline: ${writeStreamError.message}`);
  }
}

async function generateReport(resultsIds: string[], metadata?: ReportUploadMetadata) {
  await createDirectoriesIfMissing();

  const reportId = randomUUID();
  const tempFolder = path.join(TMP_FOLDER, reportId);

  await fs.mkdir(tempFolder, { recursive: true });

  try {
    for (const id of resultsIds) {
      const sourceZipPath = path.join(RESULTS_FOLDER, `${id}.zip`);
      const targetZipPath = path.join(tempFolder, `${id}.zip`);

      const { result: stats, error: statError } = await withError(fs.stat(sourceZipPath));

      if (statError || !stats) {
        throw new Error(
          `source zip file not found or inaccessible for result ${id}: ${statError?.message}`
        );
      }

      if (stats.size === 0) {
        throw new Error(`zip file for result ${id} is empty`);
      }

      const { error: copyError } = await withError(fs.copyFile(sourceZipPath, targetZipPath));

      if (copyError) {
        throw new Error(`failed to copy zip file for result ${id}: ${copyError.message}`);
      }
    }

    const generated = await generatePlaywrightReport(reportId, metadata ?? {});
    const info = await parseReportMetadata(reportId, generated.reportPath, metadata);

    return {
      reportId,
      reportPath: generated.reportPath,
      report: info as unknown as ReportHistory,
    };
  } finally {
    await fs.rm(tempFolder, { recursive: true, force: true });
  }
}

async function parseReportMetadata(
  reportID: string,
  reportPath: string,
  metadata?: ReportUploadMetadata
): Promise<ReportUploadMetadata> {
  const html = await fs.readFile(path.join(reportPath, 'index.html'), 'utf-8');
  const info = await parse(html as string);
  const sizeBytes = await getFolderSize.loose(reportPath);

  const content = Object.assign(
    info,
    {
      reportID,
      createdAt: info.startTime ? new Date(info.startTime).toISOString() : new Date().toISOString(),
      sizeBytes,
      size: bytesToString(sizeBytes),
      reportUrl: `${serveReportRoute}/${reportID}/index.html`,
      project: '',
    },
    metadata ?? {}
  );
  if (metadata?.displayNumber) content.displayNumber = metadata.displayNumber;

  return content;
}

async function uploadReportFromZipFile(
  reportId: string,
  zipFilePath: string,
  metadata?: ReportUploadMetadata,
  onProgress?: (completed: number, total: number) => void
): Promise<{ reportPath: string; report: ReportHistory }> {
  await createDirectoriesIfMissing();

  const reportPath = path.join(REPORTS_FOLDER, reportId);
  await fs.mkdir(reportPath, { recursive: true });

  const concurrency = env.S3_BATCH_SIZE || 10;
  const semaphore = new Semaphore(concurrency);

  const directory = await Open.file(zipFilePath);
  const fileEntries = directory.files
    .filter((file) => file.type === 'File')
    .map((file) => ({ file, safePath: safeZipEntryPath(file.path) }));
  const foundIndexHtml = fileEntries.some((entry) => entry.safePath === 'index.html');

  if (!foundIndexHtml) {
    throw new Error('index.html not found at root of uploaded report ZIP');
  }

  const totalFiles = fileEntries.length;
  let completedFiles = 0;
  onProgress?.(0, totalFiles);

  await Promise.all(
    fileEntries.map(({ file, safePath }) =>
      semaphore.run(async () => {
        const targetPath = path.join(reportPath, safePath);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await pipeline(file.stream(), createWriteStream(targetPath));
        completedFiles++;
        onProgress?.(completedFiles, totalFiles);
      })
    )
  );

  const info = await parseReportMetadata(reportId, reportPath, metadata);

  return { reportPath, report: info as unknown as ReportHistory };
}

// Bucket-relative keys map to `${CWD}/${key}` on disk (DATA_FOLDER is `${CWD}/data`).
async function listKeys(prefix: string): Promise<string[]> {
  const { result: entries } = await withError(
    fs.readdir(path.join(CWD, prefix), { withFileTypes: true, recursive: true })
  );
  if (!entries) return [];
  const keys: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = path.join(entry.parentPath, entry.name);
    keys.push(path.relative(CWD, absolute).split(path.sep).join('/'));
  }
  return keys;
}

async function listEntries(prefix: string): Promise<StorageEntry[]> {
  const keys = await listKeys(prefix);
  return processWithConcurrency(keys, 10, async (key) => {
    const { result: stat, error } = await withError(fs.stat(path.join(CWD, key)));
    if (error || !stat) {
      console.warn(`[fs] could not stat ${key}, counting as 0 bytes`);
      return { key, size: 0 };
    }
    return { key, size: stat.size };
  });
}

async function reportAttachmentSizes(
  reportId: string,
  storagePath: string | null
): Promise<AttachmentSizes> {
  return summarizeAttachments(listEntries, reportId, storagePath);
}

async function deleteReportAttachments(
  reportId: string,
  storagePath: string | null,
  kinds: AttachmentCleanupKind[]
): Promise<AttachmentDeleteResult> {
  if (!resolveReportFolder(reportId, storagePath)) {
    throw new Error(`report ${reportId} resolves outside the reports root, refusing to delete`);
  }
  const { entries, traceDirectory } = await collectAttachments(
    listEntries,
    reportId,
    storagePath,
    kinds
  );

  const result = await deleteEntries(entries, 10, 'fs', (key) =>
    fs.rm(path.join(CWD, key), { force: true })
  );

  if (traceDirectory) {
    await withError(fs.rm(path.join(CWD, traceDirectory), { recursive: true, force: true }));
  }

  return result;
}

function resolveWithinData(key: string): string | null {
  const resolved = path.resolve(CWD, key);
  const root = path.resolve(DATA_FOLDER);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

async function readToString(key: string): Promise<string | null> {
  const fullPath = resolveWithinData(key);
  if (!fullPath) return null;
  const { result } = await withError(fs.readFile(fullPath, 'utf-8'));
  return result ?? null;
}

async function readToBuffer(key: string): Promise<Buffer | null> {
  const fullPath = resolveWithinData(key);
  if (!fullPath) return null;
  const { result } = await withError(fs.readFile(fullPath));
  return result ?? null;
}

// FS storage keeps branding assets on local disk only; nothing to mirror.
async function noopBrandingAsset(_relativePath: string): Promise<void> {
  return;
}

// In FS mode the on-disk copy IS the report - never remove it after generation.
async function noopCleanupGeneratedReport(_reportId: string): Promise<void> {
  return;
}

export const FS: Storage = {
  reportExists,
  resultExists,
  readFile,
  deleteResults,
  deleteReports,
  saveResult,
  generateReport,
  uploadReportFromZipFile,
  listKeys,
  deleteReportAttachments,
  reportAttachmentSizes,
  readToString,
  readToBuffer,
  cleanupGeneratedReport: noopCleanupGeneratedReport,
  uploadBrandingAsset: noopBrandingAsset,
  ensureBrandingAsset: noopBrandingAsset,
  deleteBrandingAsset: noopBrandingAsset,
};

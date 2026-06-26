import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import getFolderSize from 'get-folder-size';
import { Open } from 'unzipper';
import { env } from '../../config/env.js';
import { serveReportRoute } from '../constants.js';
import { parse } from '../parser/index.js';
import { generatePlaywrightReport } from '../pw.js';
import { processWithConcurrency, Semaphore } from '../utils/semaphore.js';
import { withError } from '../withError.js';
import {
  DEFAULT_STREAM_CHUNK_SIZE,
  REPORTS_FOLDER,
  RESULTS_FOLDER,
  TMP_FOLDER,
} from './constants.js';
import { createDirectory } from './folders.js';
import { bytesToString } from './format.js';
import { safeZipEntryPath } from './streamUtils.js';
import type {
  ByteRange,
  ReadFileResult,
  ReportHistory,
  ReportPath,
  ReportUploadMetadata,
  Storage,
} from './types.js';

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
    const start = Math.max(0, Math.floor(range.start));
    const end = range.end !== undefined ? Math.min(Math.floor(range.end), total - 1) : total - 1;
    if (start < total && start <= end) {
      return {
        body: createReadStream(fullPath, { start, end }),
        size: end - start + 1,
        totalSize: total,
        contentRange: { start, end, total },
      };
    }
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

async function reportExists(reportId: string): Promise<boolean> {
  return pathIsFile(path.join(REPORTS_FOLDER, reportId, 'index.html'));
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

async function deleteReports(reports: ReportPath[]) {
  const paths = reports.map((report) => report.reportID);

  await processWithConcurrency(paths, 10, async (id) => {
    const { error } = await withError(deleteReport(id));
    if (error) {
      console.warn(`[fs] failed to delete report ${id}:`, error);
    }
  });
}

async function deleteReport(reportId: string) {
  const reportPath = path.join(REPORTS_FOLDER, reportId);

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
  cleanupGeneratedReport: noopCleanupGeneratedReport,
  uploadBrandingAsset: noopBrandingAsset,
  ensureBrandingAsset: noopBrandingAsset,
  deleteBrandingAsset: noopBrandingAsset,
};

import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { SiteWhiteLabelConfig } from '@playwright-reports/shared';
import getFolderSize from 'get-folder-size';
import { Open } from 'unzipper';
import { env } from '../../config/env.js';
import { defaultConfig, isConfigValid, noConfigErr } from '../config.js';
import { serveReportRoute } from '../constants.js';
import { parse } from '../parser/index.js';
import { generatePlaywrightReport } from '../pw.js';
import { processWithConcurrency, Semaphore } from '../utils/semaphore.js';
import { withError } from '../withError.js';
import {
  APP_CONFIG,
  DATA_FOLDER,
  DEFAULT_STREAM_CHUNK_SIZE,
  REPORTS_FOLDER,
  RESULTS_FOLDER,
  TMP_FOLDER,
} from './constants.js';
import { createDirectory } from './folders.js';
import { bytesToString } from './format.js';
import type {
  ReportHistory,
  ReportMetadata,
  ReportPath,
  ServerDataInfo,
  Storage,
} from './types.js';

async function createDirectoriesIfMissing() {
  await createDirectory(RESULTS_FOLDER);
  await createDirectory(REPORTS_FOLDER);
  await createDirectory(TMP_FOLDER);
}

const getSizeInMb = async (dir: string) => {
  const sizeBytes = await getFolderSize.loose(dir);

  return bytesToString(sizeBytes);
};

async function getAvailableSize(dir: string) {
  const stat = await fs.statfs(dir);

  const availableSize = stat.bsize * stat.bavail;

  return bytesToString(availableSize);
}

async function getResultsCount() {
  const files = await fs.readdir(RESULTS_FOLDER);

  return files.filter((file) => file.endsWith('.zip')).length;
}

async function getReportsCount() {
  const entries = await fs.readdir(REPORTS_FOLDER, { withFileTypes: true });

  return entries.filter((entry) => entry.isDirectory()).length;
}

export async function getServerDataInfo(): Promise<ServerDataInfo> {
  await createDirectoriesIfMissing();
  const dataFolderSizeinMB = await getSizeInMb(DATA_FOLDER);
  const resultsCount = await getResultsCount();
  const resultsFolderSizeinMB = await getSizeInMb(RESULTS_FOLDER);
  const reportsCount = await getReportsCount();
  const reportsFolderSizeinMB = await getSizeInMb(REPORTS_FOLDER);
  const availableSizeinMB = await getAvailableSize('./');

  return {
    dataFolderSizeinMB,
    numOfResults: resultsCount,
    resultsFolderSizeinMB,
    numOfReports: reportsCount,
    reportsFolderSizeinMB,
    availableSizeinMB,
  };
}

export async function readFile(targetPath: string, contentType: string | null) {
  return await fs.readFile(path.join(REPORTS_FOLDER, targetPath), {
    encoding: contentType === 'text/html' ? 'utf-8' : null,
  });
}

export async function deleteResults(resultsIds: string[]) {
  await Promise.allSettled(resultsIds.map((id) => deleteResult(id)));
}

export async function deleteResult(resultId: string) {
  const resultPath = path.join(RESULTS_FOLDER, resultId);

  await fs.unlink(`${resultPath}.zip`).catch(() => {});
}

export async function deleteReports(reports: ReportPath[]) {
  const paths = reports.map((report) => report.reportID);

  await processWithConcurrency(paths, 10, async (path) => {
    await deleteReport(path);
  });
}

export async function deleteReport(reportId: string) {
  const reportPath = path.join(REPORTS_FOLDER, reportId);

  await fs.rm(reportPath, { recursive: true, force: true });
}

export async function saveResult(filename: string, stream: PassThrough) {
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

export async function generateReport(resultsIds: string[], metadata?: ReportMetadata) {
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
  metadata?: ReportMetadata
): Promise<ReportMetadata> {
  const html = await fs.readFile(path.join(reportPath, 'index.html'), 'utf-8');
  const info = await parse(html as string);
  const sizeBytes = await getFolderSize.loose(reportPath);

  const content = Object.assign(
    info,
    {
      reportID,
      createdAt: info.startTime ? new Date(info.startTime).toISOString() : new Date().toISOString(),
      sizeBytes: await getFolderSize.loose(reportPath).then(bytesToString),
      size: bytesToString(sizeBytes),
      reportUrl: `${serveReportRoute}/${reportID}/index.html`,
      project: '',
    },
    metadata ?? {}
  );
  if (metadata?.displayNumber) content.displayNumber = metadata.displayNumber;

  return content;
}

async function readConfigFile() {
  const { error: accessConfigError } = await withError(fs.access(APP_CONFIG));

  if (accessConfigError) {
    return { result: defaultConfig, error: new Error(noConfigErr) };
  }

  const { result, error } = await withError(fs.readFile(APP_CONFIG, 'utf-8'));

  if (error || !result) {
    return { error };
  }

  try {
    const parsed = JSON.parse(result);

    const isValid = isConfigValid(parsed);

    return isValid ? { result: parsed, error: null } : { error: new Error('invalid config') };
  } catch (e) {
    return {
      error: new Error(`failed to parse config: ${e instanceof Error ? e.message : e}`),
    };
  }
}

async function saveConfigFile(config: Partial<SiteWhiteLabelConfig>) {
  const { result: existingConfig, error: configError } = await readConfigFile();

  const isConfigFailed = !!configError && configError?.message !== noConfigErr && !existingConfig;

  if (isConfigFailed) {
    console.error(`[fs] failed to read existing config: ${configError.message}`);
  }

  const previousConfig = existingConfig ?? defaultConfig;
  const uploadConfig = { ...previousConfig, ...config };

  const { error } = await withError(
    fs.writeFile(APP_CONFIG, JSON.stringify(uploadConfig, null, 2), {
      flag: 'w+',
    })
  );

  return {
    result: uploadConfig,
    error,
  };
}

async function uploadReportFromZipFile(
  reportId: string,
  zipFilePath: string,
  metadata?: ReportMetadata
): Promise<{ reportPath: string; report: ReportHistory }> {
  await createDirectoriesIfMissing();

  const reportPath = path.join(REPORTS_FOLDER, reportId);
  await fs.mkdir(reportPath, { recursive: true });

  const concurrency = env.S3_BATCH_SIZE || 10;
  const semaphore = new Semaphore(concurrency);

  const directory = await Open.file(zipFilePath);
  const fileEntries = directory.files.filter((file) => file.type === 'File');
  const foundIndexHtml = fileEntries.some((file) => file.path === 'index.html');

  if (!foundIndexHtml) {
    throw new Error('index.html not found at root of uploaded report ZIP');
  }

  await Promise.all(
    fileEntries.map((file) =>
      semaphore.run(async () => {
        const targetPath = path.join(reportPath, file.path);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await pipeline(file.stream(), createWriteStream(targetPath));
      })
    )
  );

  const info = await parseReportMetadata(reportId, reportPath, metadata);

  return { reportPath, report: info as unknown as ReportHistory };
}

export const FS: Storage = {
  getServerDataInfo,
  readFile,
  deleteResults,
  deleteReports,
  saveResult,
  generateReport,
  uploadReportFromZipFile,
  readConfigFile,
  saveConfigFile,
};

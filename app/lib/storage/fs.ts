import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWriteStream, type Dirent, type Stats } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { PassThrough } from 'node:stream';

import getFolderSize from 'get-folder-size';

import { bytesToString } from './format';
import {
  APP_CONFIG,
  DATA_FOLDER,
  DEFAULT_STREAM_CHUNK_SIZE,
  REPORT_METADATA_FILE,
  REPORTS_FOLDER,
  REPORTS_PATH,
  RESULTS_FOLDER,
  TMP_FOLDER,
} from './constants';
import { processBatch } from './batch';
import { handlePagination } from './pagination';
import { createDirectory } from './folders';

import { defaultConfig, isConfigValid, noConfigErr } from '@/app/lib/config';
import { parse } from '@/app/lib/parser';
import { generatePlaywrightReport } from '@/app/lib/pw';
import { withError } from '@/app/lib/withError';
import { serveReportRoute } from '@/app/lib/constants';
import {
  type Storage,
  type Result,
  type ServerDataInfo,
  type ResultDetails,
  ReadReportsOutput,
  ReadReportsInput,
  ReadResultsInput,
  ReportMetadata,
  ReportHistory,
} from '@/app/lib/storage';
import { SiteWhiteLabelConfig } from '@/app/types';

async function createDirectoriesIfMissing() {
  await createDirectory(RESULTS_FOLDER);
  await createDirectory(REPORTS_FOLDER);
  await createDirectory(TMP_FOLDER);
}

const getSizeInMb = async (dir: string) => {
  const sizeBytes = await getFolderSize.loose(dir);

  return bytesToString(sizeBytes);
};

export async function getServerDataInfo(): Promise<ServerDataInfo> {
  await createDirectoriesIfMissing();
  const dataFolderSizeinMB = await getSizeInMb(DATA_FOLDER);
  const resultsCount = await getResultsCount();
  const resultsFolderSizeinMB = await getSizeInMb(RESULTS_FOLDER);
  const { total: reportsCount } = await readReports();
  const reportsFolderSizeinMB = await getSizeInMb(REPORTS_FOLDER);

  return {
    dataFolderSizeinMB,
    numOfResults: resultsCount,
    resultsFolderSizeinMB,
    numOfReports: reportsCount,
    reportsFolderSizeinMB,
  };
}

export async function readFile(targetPath: string, contentType: string | null) {
  return await fs.readFile(path.join(REPORTS_FOLDER, targetPath), {
    encoding: contentType === 'text/html' ? 'utf-8' : null,
  });
}

async function getResultsCount() {
  const files = await fs.readdir(RESULTS_FOLDER);

  return Math.round(files.length / 2);
}

export async function readResults(input?: ReadResultsInput) {
  await createDirectoriesIfMissing();
  const files = await fs.readdir(RESULTS_FOLDER);

  const stats = await processBatch<string, Stats & { filePath: string; size: string; sizeBytes: number }>(
    {},
    files.filter((file) => file.endsWith('.json')),
    20,
    async (file) => {
      const filePath = path.join(RESULTS_FOLDER, file);

      const stat = await fs.stat(filePath);

      const sizeBytes = await getFolderSize.loose(filePath.replace('.json', '.zip'));

      const size = bytesToString(sizeBytes);

      return Object.assign(stat, { filePath, size, sizeBytes });
    },
  );

  const jsonFiles = stats.sort((a, b) => b.birthtimeMs - a.birthtimeMs);

  const fileContents: Result[] = await Promise.all(
    jsonFiles.map(async (entry) => {
      const content = await fs.readFile(entry.filePath, 'utf-8');

      return {
        size: entry.size,
        sizeBytes: entry.sizeBytes,
        ...JSON.parse(content),
      };
    }),
  );

  let filteredResults = fileContents.filter((result) => (input?.project ? result.project === input.project : result));

  // Filter by tags if provided
  if (input?.tags && input.tags.length > 0) {
    const notMetadataKeys = ['resultID', 'title', 'createdAt', 'size', 'sizeBytes', 'project'];

    filteredResults = filteredResults.filter((result) => {
      const resultTags = Object.entries(result)
        .filter(([key]) => !notMetadataKeys.includes(key))
        .map(([key, value]) => `${key}: ${value}`);

      return input.tags!.some((selectedTag) => resultTags.includes(selectedTag));
    });
  }

  // Filter by search if provided
  if (input?.search?.trim()) {
    const searchTerm = input.search.toLowerCase().trim();

    filteredResults = filteredResults.filter((result) => {
      // Search in title, resultID, project, and all metadata fields
      const searchableFields = [
        result.title,
        result.resultID,
        result.project,
        ...Object.entries(result)
          .filter(([key]) => !['resultID', 'title', 'createdAt', 'size', 'sizeBytes', 'project'].includes(key))
          .map(([key, value]) => `${key}: ${value}`),
      ].filter(Boolean);

      return searchableFields.some((field) => field?.toLowerCase().includes(searchTerm));
    });
  }

  const paginatedResults = handlePagination(filteredResults, input?.pagination);

  return {
    results: paginatedResults.map((result) => ({
      ...result,
    })),
    total: filteredResults.length,
  };
}

function isMissingFileError(error?: Error | null) {
  return error?.message.includes('ENOENT');
}

async function readOrParseReportMetadata(id: string, projectName: string): Promise<ReportMetadata> {
  console.log(`checking metadata for report ${projectName}/${id}`);
  const { result: metadataContent, error: metadataError } = await withError(
    readFile(path.join(projectName, id, REPORT_METADATA_FILE), 'utf-8'),
  );

  if (metadataError) console.error(`failed to read metadata for ${id}: ${metadataError.message}`);

  const metadata = metadataContent && !metadataError ? JSON.parse(metadataContent.toString()) : {};

  if (!isMissingFileError(metadataError)) {
    return metadata;
  }

  console.log(`metadata file not found for ${id}, creating new metadata`);
  try {
    const parsed = await parseReportMetadata(id, path.join(REPORTS_FOLDER, projectName, id), {
      project: projectName,
      reportID: id,
    });

    console.log(`parsed metadata for ${id}`);

    await saveReportMetadata(path.join(REPORTS_FOLDER, projectName, id), parsed);

    Object.assign(metadata, parsed);
  } catch (e) {
    console.error(`failed to create metadata for ${id}: ${(e as Error).message}`);
  }

  return metadata;
}

export async function readReports(input?: ReadReportsInput): Promise<ReadReportsOutput> {
  await createDirectoriesIfMissing();
  const entries = await fs.readdir(REPORTS_FOLDER, { withFileTypes: true, recursive: true });

  const reportEntries = entries
    .filter((entry) => !entry.isDirectory() && entry.name === 'index.html' && !(entry as any).path.endsWith('trace'))
    .filter((entry) => (input?.ids ? input.ids.some((id) => (entry as any).path.includes(id)) : entry))
    .filter((entry) => (input?.project ? (entry as any).path.includes(input.project) : entry));

  const stats = await processBatch<Dirent, Stats & { filePath: string; createdAt: Date }>(
    {},
    reportEntries,
    20,
    async (file) => {
      const stat = await fs.stat((file as any).path);

      return Object.assign(stat, { filePath: (file as any).path, createdAt: stat.birthtime });
    },
  );

  const reportFiles = stats.sort((a, b) => b.birthtimeMs - a.birthtimeMs);

  const reportsWithProject = reportFiles
    .map((file) => {
      const id = path.basename(file.filePath);
      const parentDir = path.basename(path.dirname(file.filePath));

      const projectName = parentDir === REPORTS_PATH ? '' : parentDir;

      return Object.assign(file, { id, project: projectName });
    })
    .filter((report) => (input?.project ? input.project === report.project : report));

  const allReports = await Promise.all(
    reportsWithProject.map(async (file) => {
      const id = path.basename(file.filePath);
      const reportPath = path.dirname(file.filePath);
      const parentDir = path.basename(reportPath);
      const sizeBytes = await getFolderSize.loose(path.join(reportPath, id));
      const size = bytesToString(sizeBytes);

      const projectName = parentDir === REPORTS_PATH ? '' : parentDir;

      const metadata = await readOrParseReportMetadata(id, projectName);

      return {
        reportID: id,
        project: projectName,
        createdAt: file.birthtime,
        size,
        sizeBytes,
        reportUrl: `${serveReportRoute}/${projectName ? encodeURIComponent(projectName) : ''}/${id}/index.html`,
        ...metadata,
      };
    }),
  );

  let filteredReports = allReports as ReportHistory[];

  // Filter by search if provided
  if (input?.search && input.search.trim()) {
    const searchTerm = input.search.toLowerCase().trim();

    filteredReports = filteredReports.filter((report) => {
      // Search in title, reportID, project, and all metadata fields
      const searchableFields = [
        report.title,
        report.reportID,
        report.project,
        ...Object.entries(report)
          .filter(
            ([key]) =>
              !['reportID', 'title', 'createdAt', 'size', 'sizeBytes', 'project', 'reportUrl', 'stats'].includes(key),
          )
          .map(([key, value]) => `${key}: ${value}`),
      ].filter(Boolean);

      return searchableFields.some((field) => field?.toLowerCase().includes(searchTerm));
    });
  }

  const paginatedReports = handlePagination(filteredReports, input?.pagination);

  return { reports: paginatedReports as ReportHistory[], total: filteredReports.length };
}

export async function deleteResults(resultsIds: string[]) {
  await Promise.allSettled(resultsIds.map((id) => deleteResult(id)));
}

export async function deleteResult(resultId: string) {
  const resultPath = path.join(RESULTS_FOLDER, resultId);

  await Promise.allSettled([fs.unlink(`${resultPath}.json`), fs.unlink(`${resultPath}.zip`)]);
}

export async function deleteReports(reportsIds: string[]) {
  const { reports } = await readReports({ ids: reportsIds });

  const paths = reportsIds
    .map((id) => reports.find((report) => report.reportID === id))
    .filter(Boolean)
    .map((report) => (report?.project ? `${report.project}/${report.reportID}` : report?.reportID));

  await Promise.allSettled(paths.map((path) => deleteReport(path!)));
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

export async function saveResultDetails(resultID: string, resultDetails: ResultDetails, size: number): Promise<Result> {
  await createDirectoriesIfMissing();

  const metaData = {
    resultID,
    createdAt: new Date().toISOString(),
    project: resultDetails?.project ?? '',
    ...resultDetails,
    size: bytesToString(size),
    sizeBytes: size,
  };

  const { error: writeJsonError } = await withError(
    fs.writeFile(path.join(RESULTS_FOLDER, `${resultID}.json`), JSON.stringify(metaData, null, 2), {
      encoding: 'utf-8',
    }),
  );

  if (writeJsonError) {
    throw new Error(`failed to save result ${resultID} json file: ${writeJsonError.message}`);
  }

  return metaData as Result;
}

export async function generateReport(resultsIds: string[], metadata?: ReportMetadata) {
  await createDirectoriesIfMissing();

  const reportId = randomUUID();
  const tempFolder = path.join(TMP_FOLDER, reportId);

  const { error: mkdirTempError } = await withError(fs.mkdir(tempFolder, { recursive: true }));

  if (mkdirTempError) {
    throw new Error(`failed to create temp folder to generate report: ${mkdirTempError.message}`);
  }

  for (const id of resultsIds) {
    await fs.copyFile(path.join(RESULTS_FOLDER, `${id}.zip`), path.join(tempFolder, `${id}.zip`));
  }

  const { error: generateReportError, result: generated } = await withError(
    generatePlaywrightReport(reportId, metadata!),
  );

  const { error: parsedMetadataError, result: info } = await withError(
    parseReportMetadata(reportId, generated?.reportPath ?? '', metadata),
  );

  if (parsedMetadataError) console.error(`failed to parse metadata: ${parsedMetadataError.message}`);

  if (!generateReportError && info) {
    const { error: writeJsonError } = await withError(saveReportMetadata(generated?.reportPath ?? '', info));

    if (writeJsonError)
      console.error(`failed to save metadata file for ${reportId} json file: ${writeJsonError.message}`);
  }

  const { error } = await withError(fs.rm(tempFolder, { recursive: true, force: true }));

  if (error) {
    console.log(`failed to remove temp folder: ${error.message}`);
  }

  return reportId;
}

async function parseReportMetadata(
  reportID: string,
  reportPath: string,
  metadata?: ReportMetadata,
): Promise<ReportMetadata> {
  const html = await fs.readFile(path.join(reportPath, 'index.html'), 'utf-8');
  const info = await parse(html as string);

  const content = Object.assign(
    info,
    {
      reportID,
      createdAt: new Date().toISOString(),
    },
    metadata ?? {},
  );

  return content;
}

async function saveReportMetadata(reportPath: string, info: ReportMetadata) {
  return fs.writeFile(path.join(reportPath, REPORT_METADATA_FILE), JSON.stringify(info, null, 2), {
    encoding: 'utf-8',
  });
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
    return { error: new Error(`failed to parse config: ${e instanceof Error ? e.message : e}`) };
  }
}

async function saveConfigFile(config: Partial<SiteWhiteLabelConfig>) {
  const { result: existingConfig, error: configError } = await readConfigFile();

  const isConfigFailed = !!configError && configError?.message !== noConfigErr && !existingConfig;

  if (isConfigFailed) {
    console.error(`failed to read existing config: ${configError.message}`);
  }

  const previousConfig = existingConfig ?? defaultConfig;
  const uploadConfig = { ...previousConfig, ...config };

  const { error } = await withError(fs.writeFile(APP_CONFIG, JSON.stringify(uploadConfig, null, 2), { flag: 'w+' }));

  return {
    result: uploadConfig,
    error,
  };
}

export const FS: Storage = {
  getServerDataInfo,
  readFile,
  readResults,
  readReports,
  deleteResults,
  deleteReports,
  saveResult,
  saveResultDetails,
  generateReport,
  readConfigFile,
  saveConfigFile,
};

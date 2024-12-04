import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { type Dirent, type Stats } from 'node:fs';

import getFolderSize from 'get-folder-size';

import { bytesToString, getUniqueProjectsList } from './format';
import { DATA_FOLDER, REPORTS_FOLDER, REPORTS_PATH, RESULTS_FOLDER, TMP_FOLDER } from './constants';
import { processBatch } from './batch';
import { handlePagination } from './pagination';

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
} from '@/app/lib/storage';

async function createDirectoriesIfMissing() {
  async function createDirectory(dir: string) {
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
      console.log('Created directory:', dir);
    }
  }

  await createDirectory(RESULTS_FOLDER);
  await createDirectory(REPORTS_FOLDER);
  await createDirectory(TMP_FOLDER);
}

const getFolderSizeInMb = async (dir: string) => {
  const sizeBytes = await getFolderSize.loose(dir);

  return bytesToString(sizeBytes);
};

export async function getServerDataInfo(): Promise<ServerDataInfo> {
  await createDirectoriesIfMissing();
  const dataFolderSizeinMB = await getFolderSizeInMb(DATA_FOLDER);
  const resultsCount = await getResultsCount();
  const resultsFolderSizeinMB = await getFolderSizeInMb(RESULTS_FOLDER);
  const { total: reportsCount } = await readReports();
  const reportsFolderSizeinMB = await getFolderSizeInMb(REPORTS_FOLDER);

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

  const stats = await processBatch<string, Stats & { filePath: string }>({}, files, 20, async (file) => {
    const filePath = path.join(RESULTS_FOLDER, file);

    const stat = await fs.stat(filePath);

    return Object.assign(stat, { filePath });
  });

  const jsonFiles = stats
    .filter((stat) => stat.isFile() && path.extname(stat.filePath) === '.json')
    .sort((a, b) => b.birthtimeMs - a.birthtimeMs)
    .map((stat) => stat.filePath);

  const fileContents: Result[] = await Promise.all(
    jsonFiles.map(async (filePath) => {
      const content = await fs.readFile(filePath, 'utf-8');

      return JSON.parse(content);
    }),
  );

  const resultsByProject = fileContents.filter((result) =>
    input?.project ? result.project === input.project : result,
  );

  const paginatedResults = handlePagination(resultsByProject, input?.pagination);

  return {
    results: paginatedResults,
    total: resultsByProject.length,
  };
}

export async function readReports(input?: ReadReportsInput): Promise<ReadReportsOutput> {
  await createDirectoriesIfMissing();
  const entries = await fs.readdir(REPORTS_FOLDER, { withFileTypes: true, recursive: true });

  const reportEntries = entries
    .filter((entry) => !entry.isDirectory() && entry.name === 'index.html' && !entry.path.endsWith('trace'))
    .filter((entry) => (input?.ids ? input.ids.some((id) => entry.path.includes(id)) : entry))
    .filter((entry) => (input?.project ? entry.path.includes(input.project) : entry));

  const stats = await processBatch<Dirent, Stats & { filePath: string; createdAt: Date }>(
    {},
    reportEntries,
    20,
    async (file) => {
      const stat = await fs.stat(file.path);

      return Object.assign(stat, { filePath: file.path, createdAt: stat.birthtime });
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

  const paginatedFiles = handlePagination(reportsWithProject, input?.pagination);

  const reports = await Promise.all(
    paginatedFiles.map(async (file) => {
      const id = path.basename(file.filePath);
      const reportPath = path.dirname(file.filePath);
      const parentDir = path.basename(reportPath);
      const size = await getFolderSizeInMb(path.join(reportPath, id));

      const projectName = parentDir === REPORTS_PATH ? '' : parentDir;

      return {
        reportID: id,
        project: projectName,
        createdAt: file.birthtime,
        size,
        reportUrl: `${serveReportRoute}/${projectName ? encodeURIComponent(projectName) : ''}/${id}/index.html`,
      };
    }),
  );

  return { reports, total: reportsWithProject.length };
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

export async function saveResult(buffer: Buffer, resultDetails: ResultDetails) {
  await createDirectoriesIfMissing();
  const resultID = randomUUID();
  const resultPath = path.join(RESULTS_FOLDER, `${resultID}.zip`);

  const { error: writeZipError } = await withError(fs.writeFile(resultPath, buffer));

  const size = await getFolderSizeInMb(resultPath);

  if (writeZipError) {
    throw new Error(`failed to save result ${resultID} zip file: ${writeZipError.message}`);
  }

  const metaData = {
    resultID,
    createdAt: new Date().toISOString(),
    size,
    ...resultDetails,
  };

  const { error: writeJsonError } = await withError(
    fs.writeFile(path.join(RESULTS_FOLDER, `${resultID}.json`), Buffer.from(JSON.stringify(metaData, null, 2))),
  );

  if (writeJsonError) {
    throw new Error(`failed to save result ${resultID} json file: ${writeJsonError.message}`);
  }

  return metaData;
}

export async function generateReport(resultsIds: string[], project?: string) {
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

  await generatePlaywrightReport(reportId, project);

  const { error } = await withError(fs.rm(tempFolder, { recursive: true, force: true }));

  if (error) {
    console.log(`failed to remove temp folder: ${error.message}`);
  }

  return reportId;
}

export async function getReportsProjects(): Promise<string[]> {
  const { reports } = await readReports();

  return getUniqueProjectsList(reports);
}

export async function getResultsProjects(): Promise<string[]> {
  const { results } = await readResults();

  return getUniqueProjectsList(results);
}

export async function moveReport(oldPath: string, newPath: string): Promise<void> {
  const reportPath = path.join(REPORTS_FOLDER, oldPath);
  const newReportPath = path.join(REPORTS_FOLDER, newPath);

  await fs.mkdir(path.dirname(newReportPath), { recursive: true });

  await fs.rename(reportPath, newReportPath);
}

export const FS: Storage = {
  getServerDataInfo,
  readFile,
  readResults,
  readReports,
  deleteResults,
  deleteReports,
  saveResult,
  generateReport,
  getReportsProjects,
  getResultsProjects,
  moveReport,
};

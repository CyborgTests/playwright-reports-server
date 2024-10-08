import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import getFolderSize from 'get-folder-size';

import { bytesToString } from './format';
import { DATA_FOLDER, REPORTS_FOLDER, REPORTS_PATH, RESULTS_FOLDER, TMP_FOLDER } from './constants';

import { generatePlaywrightReport } from '@/app/lib/pw';
import { withError } from '@/app/lib/withError';
import { serveReportRoute } from '@/app/lib/constants';
import { type Storage, type Report, type Result, type ServerDataInfo, type ResultDetails } from '@/app/lib/storage';

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
  const results = await readResults();
  const resultsFolderSizeinMB = await getFolderSizeInMb(RESULTS_FOLDER);
  const reports = await readReports();
  const reportsFolderSizeinMB = await getFolderSizeInMb(REPORTS_FOLDER);

  return {
    dataFolderSizeinMB,
    numOfResults: results.length,
    resultsFolderSizeinMB,
    numOfReports: reports.length,
    reportsFolderSizeinMB,
  };
}

export async function readFile(targetPath: string, contentType: string | null) {
  return await fs.readFile(path.join(REPORTS_FOLDER, targetPath), {
    encoding: contentType === 'text/html' ? 'utf-8' : null,
  });
}

export async function readResults() {
  await createDirectoriesIfMissing();
  const files = await fs.readdir(RESULTS_FOLDER);
  const jsonFiles = files.filter((file) => path.extname(file) === '.json');

  const fileContents: Result[] = await Promise.all(
    jsonFiles.map(async (file) => {
      const filePath = path.join(RESULTS_FOLDER, file);
      const content = await fs.readFile(filePath, 'utf-8');

      return JSON.parse(content);
    }),
  );

  return fileContents;
}

export async function readReports(): Promise<Report[]> {
  await createDirectoriesIfMissing();
  const entries = await fs.readdir(REPORTS_FOLDER, { withFileTypes: true, recursive: true });

  const reportFiles = entries.filter(
    (entry) => !entry.isDirectory() && entry.name === 'index.html' && !entry.path.endsWith('trace'),
  );

  return await Promise.all(
    reportFiles.map(async (file) => {
      const id = path.basename(file.path);
      const parentDir = path.basename(path.dirname(file.path));

      const projectName = parentDir === REPORTS_PATH ? '' : parentDir;

      const stat = await fs.stat(file.path);

      return {
        reportID: id,
        project: projectName,
        createdAt: stat.birthtime,
        reportUrl: `${serveReportRoute}/${projectName ? encodeURIComponent(projectName) : ''}/${id}/index.html`,
      };
    }),
  );
}

export async function deleteResults(resultsIds: string[]) {
  await Promise.allSettled(resultsIds.map((id) => deleteResult(id)));
}

export async function deleteResult(resultId: string) {
  const resultPath = path.join(RESULTS_FOLDER, resultId);

  await Promise.allSettled([fs.unlink(`${resultPath}.json`), fs.unlink(`${resultPath}.zip`)]);
}

export async function deleteReports(reportsIds: string[]) {
  const reports = await readReports();

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

  await fs.writeFile(path.join(RESULTS_FOLDER, `${resultID}.zip`), buffer);

  const metaData = {
    resultID,
    createdAt: new Date().toISOString(),
    ...resultDetails,
  };

  await fs.writeFile(path.join(RESULTS_FOLDER, `${resultID}.json`), Buffer.from(JSON.stringify(metaData, null, 2)));

  return metaData;
}

export async function generateReport(resultsIds: string[], project?: string) {
  await createDirectoriesIfMissing();

  const { error } = await withError(fs.rm(TMP_FOLDER, { recursive: true, force: true }));

  if (error) {
    console.log('temp folder not found, creating...');
  }

  await fs.mkdir(TMP_FOLDER, { recursive: true });

  for (const id of resultsIds) {
    await fs.copyFile(path.join(RESULTS_FOLDER, `${id}.zip`), path.join(TMP_FOLDER, `${id}.zip`));
  }

  const { reportId } = await generatePlaywrightReport(project);

  return reportId;
}

export async function getProjects(): Promise<string[]> {
  const reports = await readReports();

  return Array.from(new Set(reports.map((r) => r.project))).filter(Boolean);
}

export async function moveReport(oldPath: string, newPath: string): Promise<void> {
  const reportPath = path.join(REPORTS_FOLDER, oldPath);
  const newReportPath = path.join(REPORTS_FOLDER, newPath);

  await fs.mkdir(path.dirname(newReportPath), { recursive: true });

  await fs.rename(reportPath, newReportPath);
}

export const FS: Storage = {
  getFolderSizeInMb,
  getServerDataInfo,
  readFile,
  readResults,
  readReports,
  deleteResults,
  deleteReports,
  saveResult,
  generateReport,
  getProjects,
  moveReport,
};

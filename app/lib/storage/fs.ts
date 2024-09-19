import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import getFolderSize from 'get-folder-size';

import { bytesToString } from './format';
import { DATA_FOLDER, REPORTS_FOLDER, RESULTS_FOLDER, TMP_FOLDER } from './constants';
import { generatePlaywrightReport } from './pw';

import { withError } from '@/app/lib/withError';
import { serveReportRoute } from '@/app/lib/constants';
import {
  type Storage,
  type Report,
  type Result,
  type ServerDataInfo,
  type ResultDetails,
} from '@/app/lib/storage/types';

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

export async function readReports() {
  await createDirectoriesIfMissing();
  const dirents = await fs.readdir(REPORTS_FOLDER, { withFileTypes: true });

  const reports: Report[] = await Promise.all(
    dirents
      .filter((dirent) => dirent.isDirectory())
      .map(async (dirent) => {
        const dirPath = path.join(REPORTS_FOLDER, dirent.name);
        const stats = await fs.stat(dirPath);

        return {
          reportID: dirent.name,
          createdAt: stats.birthtime,
          reportUrl: `${serveReportRoute}/${dirent.name}/index.html`,
        };
      }),
  );

  return reports;
}

export async function deleteResults(resultsIds: string[]) {
  await Promise.allSettled(resultsIds.map((id) => deleteResult(id)));
}

export async function deleteResult(resultId: string) {
  const resultPath = path.join(RESULTS_FOLDER, resultId);

  await Promise.allSettled([fs.unlink(`${resultPath}.json`), fs.unlink(`${resultPath}.zip`)]);
}

export async function deleteReports(reportsIds: string[]) {
  await Promise.allSettled(reportsIds.map((id) => deleteReport(id)));
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

export async function generateReport(resultsIds: string[]) {
  await createDirectoriesIfMissing();

  const { error } = await withError(fs.rm(TMP_FOLDER, { recursive: true, force: true }));

  if (error) {
    console.log('temp folder not found, creating...');
  }

  await fs.mkdir(TMP_FOLDER, { recursive: true });

  for (const id of resultsIds) {
    await fs.copyFile(path.join(RESULTS_FOLDER, `${id}.zip`), path.join(TMP_FOLDER, `${id}.zip`));
  }

  const { reportId } = await generatePlaywrightReport();

  return reportId;
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
};

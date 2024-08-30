import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { exec } from 'node:child_process';
import util from 'node:util';

import getFolderSize from 'get-folder-size';
const execAsync = util.promisify(exec);

export type Result = {
  resultID: string;
  createdAt: string;
  // For custom user fields
  [key: string]: string;
};

export type Report = { reportID: string; reportUrl: string; createdAt: Date };

const DATA_FOLDER = path.join(process.cwd(), 'public', 'data');
const PW_CONFIG = path.join(process.cwd(), 'playwright.config.ts');
const TMP_FOLDER = path.join(DATA_FOLDER, '.tmp');
const RESULTS_FOLDER = path.join(DATA_FOLDER, 'results');
const REPORTS_FOLDER = path.join(DATA_FOLDER, 'reports');

async function createDirectoriesIfMissing() {
  console.log(`initServer`);
  async function createDirectory(dir: string) {
    console.log(`createDirectory: ${dir}`);
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

  return `${(sizeBytes / 1000 / 1000).toFixed(2)} MB`;
};

export async function getServerDataInfo() {
  console.log(`getServerDataInfo`);
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

export async function readResults() {
  console.log(`readResults`);
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
  console.log(`readReports`);
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
          reportUrl: `/data/reports/${dirent.name}/index.html`,
        };
      }),
  );

  return reports;
}

export async function deleteResults(resultsIds: string[]) {
  console.log(`deleteResults: ${resultsIds}`);

  return Promise.allSettled(resultsIds.map((id) => deleteResult(id)));
}

export async function deleteResult(resultId: string) {
  console.log(`deleteResult: ${resultId}`);
  const resultPath = path.join(RESULTS_FOLDER, resultId);

  return Promise.allSettled([
    fs.rm(`${resultPath}.json`, { force: true }),
    fs.rm(`${resultPath}.zip`, { force: true }),
  ]);
}

export async function deleteReports(reportsIds: string[]) {
  console.log(`deleteReports: ${reportsIds}`);

  return Promise.allSettled(reportsIds.map((id) => deleteReport(id)));
}

export async function deleteReport(reportId: string) {
  console.log(`deleteReport: ${reportId}`);
  const reportPath = path.join(REPORTS_FOLDER, reportId);

  return fs.rm(reportPath, { recursive: true, force: true });
}

export async function saveResult(buffer: Buffer, resultDetails: { [key: string]: string }) {
  console.log(`save Result: ${JSON.stringify(resultDetails, null, 2)}`);
  await createDirectoriesIfMissing();
  const resultID = randomUUID();

  await fs.writeFile(path.join(RESULTS_FOLDER, `${resultID}.zip`), buffer);

  const metaData = {
    resultID,
    createdAt: new Date().toISOString(),
    ...resultDetails,
  };

  console.log(JSON.stringify(metaData, null, 2));
  await fs.writeFile(path.join(RESULTS_FOLDER, `${resultID}.json`), Buffer.from(JSON.stringify(metaData, null, 2)));

  return metaData;
}

export async function generateReport(resultsIds: string[]) {
  await createDirectoriesIfMissing();
  try {
    await fs.rm(TMP_FOLDER, { recursive: true, force: true });
  } catch (error) {
    console.log('temp folder not found, creating...');
  }
  await fs.mkdir(TMP_FOLDER, { recursive: true });

  for (const id of resultsIds) {
    await fs.copyFile(path.join(RESULTS_FOLDER, `${id}.zip`), path.join(TMP_FOLDER, `${id}.zip`));
  }

  const reportId = randomUUID();

  await execAsync(`npx playwright merge-reports --reporter html ${TMP_FOLDER}`, {
    env: {
      ...process.env,
      // Avoid opening the report on server
      PW_TEST_HTML_REPORT_OPEN: 'never',
      PLAYWRIGHT_HTML_REPORT: path.join(REPORTS_FOLDER, reportId),
    },
  });

  return reportId;
}

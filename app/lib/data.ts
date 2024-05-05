import fs from 'node:fs/promises';
import path from 'node:path';
import { Result, Report } from './definitions';
import { randomUUID } from 'node:crypto';
import { exec, execSync } from 'node:child_process';
import util from 'node:util';
const execAsync = util.promisify(exec);

const ITEMS_PER_PAGE = 15;
const DATA_FOLDER = path.join(process.cwd(), 'public/data/');
const PW_CONFIG = path.join(process.cwd(), 'playwright.config.ts');
const TMP_FOLDER = path.join(DATA_FOLDER, '.tmp');
const RESULTS_FOLDER = path.join(DATA_FOLDER, 'results');
const REPORTS_FOLDER = path.join(DATA_FOLDER, 'reports');

async function initServer() {
  async function createDirectory(dir: string) {
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  await createDirectory(RESULTS_FOLDER);
  await createDirectory(REPORTS_FOLDER);
  await createDirectory(TMP_FOLDER);
}

const foldersInitialized = initServer();

export async function readResults(query?: string) {
  await foldersInitialized;
  const files = await fs.readdir(RESULTS_FOLDER);
  const jsonFiles = files.filter((file) => path.extname(file) === '.json');
  if (query !== undefined) {
    const filteredFiles = jsonFiles.filter((file) =>
      file.toLowerCase().includes(query.toLowerCase()),
    );
    jsonFiles.length = 0;
    jsonFiles.push(...filteredFiles);
  }

  const fileContents: Result[] = await Promise.all(
    jsonFiles.map(async (file) => {
      const filePath = path.join(RESULTS_FOLDER, file);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    }),
  );
  return fileContents;
}

export async function readReports(query?: string) {
  await foldersInitialized;
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
        };
      }),
  );
  if (query !== undefined) {
    const filteredReports = reports.filter((report) =>
      report.reportID.toLowerCase().includes(query.toLowerCase()),
    );
    reports.length = 0;
    reports.push(...filteredReports);
  }

  return reports;
}

export async function deleteResults(resultsIds: string[]) {
  await foldersInitialized;
  return Promise.allSettled(resultsIds.map((id) => deleteResult(id)));
}

export async function deleteResult(resultId: string) {
  await foldersInitialized;
  const resultPath = path.join(RESULTS_FOLDER, resultId);

  return Promise.allSettled([
    fs.unlink(`${resultPath}.json`),
    fs.unlink(`${resultPath}.zip`),
  ]);
}

export async function deleteReports(reportsIds: string[]) {
  await foldersInitialized;
  return Promise.allSettled(reportsIds.map((id) => deleteReport(id)));
}

export async function deleteReport(reportId: string) {
  await foldersInitialized;
  const reportPath = path.join(REPORTS_FOLDER, reportId);

  return fs.rm(reportPath, { recursive: true, force: true });
}

export async function saveResult(
  buffer: Buffer,
  resultDetails: { testRunName?: string; reporter?: string },
) {
  await foldersInitialized;
  const resultID = randomUUID();

  await fs.writeFile(path.join(RESULTS_FOLDER, `${resultID}.zip`), buffer);

  const metaData = {
    resultID,
    createdAt: new Date().toISOString(),
    ...resultDetails,
  };
  await fs.writeFile(
    path.join(RESULTS_FOLDER, `${resultID}.json`),
    Buffer.from(JSON.stringify(metaData, null, 2)),
  );

  return metaData;
}

export async function generateReport(resultsIds: string[]) {
  await foldersInitialized;
  try {
    await fs.rm(TMP_FOLDER, { recursive: true, force: true });
  } catch (error) {
    console.log('temp folder not found, creating...');
  }
  await fs.mkdir(TMP_FOLDER, { recursive: true });

  for (const id of resultsIds) {
    await fs.copyFile(
      path.join(RESULTS_FOLDER, `${id}.zip`),
      path.join(TMP_FOLDER, `${id}.zip`),
    );
  }

  const reportId = randomUUID();
  // TODO: Make this async
  execSync(`npx playwright merge-reports --reporter html ${TMP_FOLDER}`, {
    env: {
      ...process.env,
      // Avoid opening the report on server
      PW_TEST_HTML_REPORT_OPEN: 'never',
      PLAYWRIGHT_HTML_REPORT: path.join(REPORTS_FOLDER, reportId),
    },
  });
  return reportId;
}

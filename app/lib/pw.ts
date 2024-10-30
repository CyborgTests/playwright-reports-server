import { exec } from 'node:child_process';
import util from 'node:util';
import { randomUUID, type UUID } from 'node:crypto';
import path from 'node:path';

import { withError } from './withError';
import { REPORTS_FOLDER, TMP_FOLDER } from './storage/constants';

const execAsync = util.promisify(exec);

export const generatePlaywrightReport = async (
  projectName?: string,
): Promise<{ reportId: UUID; reportPath: string }> => {
  console.log(`[pw] generating Playwright report`);
  const reportId = randomUUID();

  console.log(`[pw] report ID: ${reportId}`);

  const reportPath = path.join(REPORTS_FOLDER, projectName ?? '', reportId);

  console.log(`[pw] report path: ${reportPath}`);

  console.log(`[pw] merging reports from ${TMP_FOLDER}`);

  const { result, error } = await withError(
    execAsync(`npx playwright merge-reports --reporter html ${TMP_FOLDER}`, {
      env: {
        ...process.env,
        // Avoid opening the report on server
        PW_TEST_HTML_REPORT_OPEN: 'never',
        PLAYWRIGHT_HTML_REPORT: reportPath,
      },
    }),
  );

  if (error ?? result?.stderr) {
    console.error(error ? JSON.stringify(error, null, 4) : result?.stderr);
  }

  return {
    reportId,
    reportPath,
  };
};

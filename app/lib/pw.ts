import { exec } from 'node:child_process';
import util from 'node:util';
import { type UUID } from 'node:crypto';
import path from 'node:path';

import { withError } from './withError';
import { REPORTS_FOLDER, TMP_FOLDER } from './storage/constants';
import { createDirectory } from './storage/folders';

const execAsync = util.promisify(exec);

export const generatePlaywrightReport = async (
  reportId: UUID,
  projectName?: string,
): Promise<{ reportPath: string }> => {
  console.log(`[pw] generating Playwright report ${reportId}`);

  const reportPath = path.join(REPORTS_FOLDER, projectName ?? '', reportId);

  await createDirectory(reportPath);

  console.log(`[pw] report path: ${reportPath}`);

  const tempFolder = path.join(TMP_FOLDER, reportId);

  console.log(`[pw] merging reports from ${tempFolder}`);

  const { result, error } = await withError(
    execAsync(`npx playwright merge-reports --reporter html ${tempFolder}`, {
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
    reportPath,
  };
};

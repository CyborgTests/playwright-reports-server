import { exec } from 'node:child_process';
import util from 'node:util';
import { type UUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';

import { withError } from './withError';
import { REPORTS_FOLDER, TMP_FOLDER } from './storage/constants';
import { createDirectory } from './storage/folders';
import { ReportMetadata } from './storage/types';
import { defaultConfig } from './config';
import { storage } from './storage';

const execAsync = util.promisify(exec);

export const isValidPlaywrightVersion = (version?: string): boolean => {
  // stupid-simple validation to check that version follows semantic version format major.minor.patch
  const versionPattern = /^\d+\.\d+\.\d+$/;

  return versionPattern.test(version ?? '');
};

export const generatePlaywrightReport = async (
  reportId: UUID,
  metadata: ReportMetadata,
): Promise<{ reportPath: string }> => {
  const { project, playwrightVersion } = metadata;

  console.log(`[pw] generating Playwright report ${reportId}`);

  const reportPath = path.join(REPORTS_FOLDER, project ?? '', reportId);

  await createDirectory(reportPath);

  console.log(`[pw] report path: ${reportPath}`);

  const tempFolder = path.join(TMP_FOLDER, reportId);

  console.log(`[pw] merging reports from ${tempFolder}`);

  const versionTag = isValidPlaywrightVersion(playwrightVersion) ? `@${playwrightVersion}` : '';

  console.log(`[pw] using playwright version tag: "${versionTag}"`);

  const { result: config } = await storage.readConfigFile();
  const customReporters = config?.reporterPaths || defaultConfig.reporterPaths || [];

  const reporterArgs = ['html'];

  if (customReporters.length > 0) {
    const resolvedReporters = customReporters
      .map((reporterPath) => {
        if (path.isAbsolute(reporterPath)) {
          return reporterPath;
        }

        return path.resolve(process.cwd(), reporterPath);
      })
      .filter((reporterPath) => {
        if (fs.existsSync(reporterPath)) {
          return true;
        }
        console.warn(`[pw] reporter file not found: ${reporterPath}`);

        return false;
      });

    if (resolvedReporters.length > 0) {
      reporterArgs.push(...resolvedReporters);
      console.log(`[pw] using custom reporters: ${resolvedReporters.join(', ')}`);
    } else {
      console.warn(`[pw] no valid custom reporters found, using only html reporter`);
    }
  }

  const { result, error } = await withError(
    execAsync(
      `npx playwright${versionTag} merge-reports --reporter ${reporterArgs.join(' --reporter ')} ${tempFolder}`,
      {
        env: {
          ...process.env,
          // Avoid opening the report on server
          PW_TEST_HTML_REPORT_OPEN: 'never',
          PLAYWRIGHT_HTML_REPORT: reportPath,
        },
      },
    ),
  );

  if (error ?? result?.stderr) {
    // Making sure to remove empty report folder if the report generation fails.
    await fs.rm(reportPath, { recursive: true, force: true });
    console.error(error ? JSON.stringify(error, null, 4) : result?.stderr);
  }

  console.log(`[pw] ${result?.stdout ?? ''}`);

  return {
    reportPath,
  };
};

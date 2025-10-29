import { exec } from 'node:child_process';
import util from 'node:util';
import { type UUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

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
        if (existsSync(reporterPath)) {
          return true;
        }
        console.warn(`[pw] reporter file not found: ${reporterPath}`);

        return false;
      });

    if (resolvedReporters.length > 0) {
      reporterArgs.push(...resolvedReporters);
    }
  }

  /**
   * Merge configuration used for server side reports merging. Needed to handle errors like this:
  Network response was not ok: Error: Command failed: npx playwright merge-reports --reporter html /app/.tmp/99f690b3-aace-4293-a988-d5945eb0d259
  Error: Blob reports being merged were recorded with different test directories, and
  merging cannot proceed. This may happen if you are merging reports from
  machines with different environments, like different operating systems or
  if the tests ran with different playwright configs.

  You can force merge by specifying a merge config file with "-c" option. If
  you'd like all test paths to be correct, make sure 'testDir' in the merge config
  file points to the actual tests location.

  Found directories:
  /builds/_JRRzYANI/1/e2e/tests/
  /builds/_JRRzYANI/2/e2e/tests/
  /builds/_JRRzYANI/3/e2e/tests/
      at mergeConfigureEvents
  */
  await fs.writeFile(path.join(tempFolder, 'merge.config.ts'), `export default { testDir: 'rootTestsDir' };`);
  try {
    const command = `npx playwright${versionTag} merge-reports --reporter ${reporterArgs.join(' --reporter ')} --config ${tempFolder}/merge.config.ts ${tempFolder}`;

    console.log(`[pw] executing merging command: ${command}`);
    const result = await execAsync(command, {
      env: {
        ...process.env,
        // Avoid opening the report on server
        PW_TEST_HTML_REPORT_OPEN: 'never',
        PLAYWRIGHT_HTML_REPORT: reportPath,
      },
    });

    console.log(result);

    if (result?.stderr) {
      // got STDERR output while generating report - throwing error since we don't know what went wrong.
      throw new Error(result?.stderr);
    }
  } catch (error) {
    await fs.rm(reportPath, { recursive: true, force: true });
    throw error;
  }

  return {
    reportPath,
  };
};

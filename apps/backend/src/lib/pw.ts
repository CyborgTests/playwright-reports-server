import { exec } from 'node:child_process';
import type { UUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import util from 'node:util';
import { defaultConfig } from './config.js';
import { siteConfigDb } from './service/db/siteConfig.sqlite.js';
import { REPORTS_FOLDER, TMP_FOLDER } from './storage/constants.js';
import { createDirectory } from './storage/folders.js';
import type { ReportMetadata } from './storage/types.js';
import { withError } from './withError.js';

const execAsync = util.promisify(exec);

export const isValidPlaywrightVersion = (version?: string): boolean => {
  // Loose semver: major.minor.patch with no pre-release/build suffixes.
  const versionPattern = /^\d+\.\d+\.\d+$/;

  return versionPattern.test(version ?? '');
};

export const generatePlaywrightReport = async (
  reportId: UUID,
  metadata: ReportMetadata
): Promise<{ reportPath: string }> => {
  const { playwrightVersion } = metadata;

  const reportPath = path.join(REPORTS_FOLDER, reportId);

  await createDirectory(reportPath);

  const tempFolder = path.join(TMP_FOLDER, reportId);
  const versionTag = isValidPlaywrightVersion(playwrightVersion) ? `@${playwrightVersion}` : '';

  console.log(`[pw] generating report ${reportId} (playwright${versionTag || ' default'})`);

  const config = siteConfigDb.get();
  const customReporters = config.reporterPaths || defaultConfig.reporterPaths || [];

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

  // Force a synthetic testDir so blob reports recorded under different working directories
  // (e.g. CI shards under /builds/_JRRzYANI/{1,2,3}/e2e/tests/) can be merged. Without this,
  // Playwright bails out with "Blob reports being merged were recorded with different test
  // directories, and merging cannot proceed."
  const mergeConfig = `export default { testDir: 'rootTestsDir' };`;

  const configPath = path.join(TMP_FOLDER, 'merge.config.ts');
  await fs.writeFile(configPath, mergeConfig);
  try {
    const { error: installCheckError } = await withError(
      execAsync(`npx playwright${versionTag} --version`)
    );

    if (installCheckError) {
      console.log(`[pw] playwright${versionTag} not found, installing...`);
      const { error: installError } = await withError(
        execAsync(`npx playwright${versionTag} install --with-deps`)
      );

      if (installError) {
        console.error(`[pw] playwright${versionTag} install error:`, installError.message);
        throw installError;
      }
    }

    const command = `npx playwright${versionTag} merge-reports --reporter ${reporterArgs.join(' --reporter ')} --config ${configPath} ${tempFolder}`;

    const { result, error } = await withError(
      execAsync(command, {
        env: {
          ...process.env,
          // Don't auto-open the report in a browser on the server.
          PW_TEST_HTML_REPORT_OPEN: 'never',
          PLAYWRIGHT_HTML_REPORT: reportPath,
        },
      })
    );

    if (error) {
      console.error('[pw] merge command error output:', error.message);
      throw error;
    }

    if (result?.stderr) {
      // stderr also carries non-fatal warnings (e.g. `npm warn …`); only fail on real errors.
      const stderr = result.stderr;
      const isWarning = stderr
        .split('\n')
        .some((line) => line.trim() !== '' && line.trim().startsWith('npm warn'));
      if (!isWarning) {
        throw new Error(stderr);
      }
    }
  } catch (error) {
    await fs.rm(reportPath, { recursive: true, force: true });
    throw error;
  }

  return {
    reportPath,
  };
};

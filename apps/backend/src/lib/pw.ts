import { execFile } from 'node:child_process';
import type { UUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import util from 'node:util';
import { defaultConfig } from './config.js';
import { resolvePlaywrightCli } from './pw-cache.js';
import { normalizeReporterPaths, validateReporterPaths } from './pw-reporters.js';
import { siteConfigDb } from './service/db/index.js';
import { REPORTS_FOLDER, TMP_FOLDER } from './storage/constants.js';
import { createDirectory } from './storage/folders.js';
import type { ReportUploadMetadata } from './storage/types.js';

const execFileAsync = util.promisify(execFile);

const MERGE_TIMEOUT_MS = 5 * 60 * 1000;

export const generatePlaywrightReport = async (
  reportId: UUID,
  metadata: ReportUploadMetadata
): Promise<{ reportPath: string }> => {
  const { playwrightVersion } = metadata;

  const reportPath = path.join(REPORTS_FOLDER, reportId);
  await createDirectory(reportPath);

  const tempFolder = path.join(TMP_FOLDER, reportId);

  const cliPath = await resolvePlaywrightCli(playwrightVersion);
  console.log(
    `[pw] generating report ${reportId} (playwright ${playwrightVersion ? `@${playwrightVersion}` : 'bundled'})`
  );

  const config = siteConfigDb.get();
  const customReporters = normalizeReporterPaths(
    config.reporterPaths ?? defaultConfig.reporterPaths
  );

  const reporters = ['html'];
  if (customReporters.length > 0) {
    const { valid, missing } = validateReporterPaths(customReporters);
    for (const { input, resolved } of missing) {
      console.warn(`[pw] reporter file not found: ${input} (resolved to ${resolved})`);
    }
    reporters.push(...valid);
  }

  // Force a synthetic testDir so blob reports recorded under different working directories
  // (e.g. CI shards under /builds/_JRRzYANI/{1,2,3}/e2e/tests/) can be merged. Without this,
  // Playwright bails out with "Blob reports being merged were recorded with different test
  // directories, and merging cannot proceed."
  const configPath = path.join(tempFolder, 'merge.config.ts');
  await fs.writeFile(configPath, `export default { testDir: 'rootTestsDir' };`);

  const args = [cliPath, 'merge-reports'];
  for (const r of reporters) args.push('--reporter', r);
  args.push('--config', configPath, tempFolder);

  try {
    await execFileAsync('node', args, {
      timeout: MERGE_TIMEOUT_MS,
      env: {
        ...process.env,
        PW_TEST_HTML_REPORT_OPEN: 'never',
        PLAYWRIGHT_HTML_REPORT: reportPath,
      },
    });
  } catch (error) {
    await fs.rm(reportPath, { recursive: true, force: true });
    const err = error as Error & { stderr?: string };
    if (err.stderr) console.error('[pw] merge stderr:', err.stderr);
    throw err;
  }

  return { reportPath };
};

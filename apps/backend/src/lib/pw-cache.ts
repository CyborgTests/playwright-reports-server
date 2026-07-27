import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import util from 'node:util';
import { PW_VERSIONS_FOLDER } from './storage/constants.js';

const execFileAsync = util.promisify(execFile);
const require = createRequire(import.meta.url);

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

// Resolved once at module load - the @playwright/test shipped with the backend.
const BUNDLED_PW_CLI = require.resolve('@playwright/test/cli');

const inflightInstalls = new Map<string, Promise<string>>();

export const isValidPlaywrightVersion = (version?: string): boolean => {
  // Accepts e.g. 1.46.0, 1.50.0-beta, 1.50.0-next-1234.
  return /^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(version ?? '');
};

const cachedCliPath = (version: string): string =>
  path.join(PW_VERSIONS_FOLDER, version, 'node_modules', 'playwright', 'cli.js');

export async function resolvePlaywrightCli(version?: string): Promise<string> {
  if (!version || !isValidPlaywrightVersion(version)) {
    return BUNDLED_PW_CLI;
  }

  const cliPath = cachedCliPath(version);
  if (existsSync(cliPath)) {
    return cliPath;
  }

  const inflight = inflightInstalls.get(version);
  if (inflight) {
    return inflight;
  }

  const promise = installPlaywrightVersion(version).finally(() => {
    inflightInstalls.delete(version);
  });
  inflightInstalls.set(version, promise);

  return promise;
}

// A cached packument predating the requested release makes npm fail with
// ETARGET even though the version exists upstream, so the freshness flag has
// to be dropped on retry.
const isStaleMetadataError = (message: string): boolean =>
  message.includes('ETARGET') || message.includes('No matching version found');

export type NpmInstaller = (cacheDir: string, version: string, freshness: string) => Promise<void>;

const npmInstall: NpmInstaller = async (cacheDir, version, freshness) => {
  await execFileAsync(
    'npm',
    [
      'install',
      `playwright@${version}`,
      '--no-save',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      freshness,
    ],
    { cwd: cacheDir, timeout: INSTALL_TIMEOUT_MS }
  );
};

export async function installPlaywrightVersion(
  version: string,
  runInstall: NpmInstaller = npmInstall
): Promise<string> {
  const cacheDir = path.join(PW_VERSIONS_FOLDER, version);
  const cliPath = cachedCliPath(version);

  console.log(`[pw-cache] installing playwright@${version}`);
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(
    path.join(cacheDir, 'package.json'),
    JSON.stringify({
      name: `pw-cache-${version.replace(/[^\w.-]/g, '-')}`,
      version: '0.0.0',
      private: true,
    })
  );

  try {
    try {
      await runInstall(cacheDir, version, '--prefer-offline');
    } catch (error) {
      const message = (error as Error).message;
      if (!isStaleMetadataError(message)) {
        throw error;
      }
      console.warn(
        `[pw-cache] playwright@${version} not found in cached registry metadata, refetching`
      );
      await runInstall(cacheDir, version, '--prefer-online');
    }
  } catch (error) {
    await fs.rm(cacheDir, { recursive: true, force: true });
    const reason = (error as Error).message;
    throw new Error(
      `failed to install playwright@${version}: ${reason}. ` +
        'Pre-warm the cache while online, point NPM_CONFIG_REGISTRY at a reachable mirror, ' +
        'or omit playwrightVersion to use the bundled Playwright.'
    );
  }

  if (!existsSync(cliPath)) {
    await fs.rm(cacheDir, { recursive: true, force: true });
    throw new Error(`playwright@${version} install completed but ${cliPath} is missing`);
  }

  console.log(`[pw-cache] cached playwright@${version}`);
  return cliPath;
}

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

// PW_VERSIONS_FOLDER is derived from process.cwd() at import time, so the
// module has to be loaded after the temporary root is in place.
const originalCwd = process.cwd();
// realpath keeps the expected paths comparable on macOS, where the temp
// directory lives behind the /var -> /private/var symlink.
const tmpRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pw-cache-test-')));
process.chdir(tmpRoot);

const { installPlaywrightVersion, isValidPlaywrightVersion } = await import('./pw-cache.js');

const versionsFolder = path.join(tmpRoot, 'data', 'playwright-versions');
const cacheDirOf = (version: string) => path.join(versionsFolder, version);
const cliPathOf = (version: string) =>
  path.join(cacheDirOf(version), 'node_modules', 'playwright', 'cli.js');

const ETARGET_ERROR = new Error(
  'Command failed: npm install playwright@1.62.0\nnpm error code ETARGET\n' +
    'npm error notarget No matching version found for playwright@1.62.0.'
);

/** Mimics npm dropping the installed CLI into the cache directory. */
async function writeCli(version: string): Promise<void> {
  const cliPath = cliPathOf(version);
  await fs.mkdir(path.dirname(cliPath), { recursive: true });
  await fs.writeFile(cliPath, '');
}

/** Records the freshness flag of every attempt, then runs the given behaviour. */
function recordingInstaller(
  behaviour: (attempt: number, version: string) => Promise<void> = () => Promise.resolve()
) {
  const freshnessFlags: string[] = [];
  const installer = async (_cacheDir: string, version: string, freshness: string) => {
    freshnessFlags.push(freshness);
    await behaviour(freshnessFlags.length, version);
  };
  return { freshnessFlags, installer };
}

before(async () => {
  await fs.mkdir(versionsFolder, { recursive: true });
});

after(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('isValidPlaywrightVersion', () => {
  it('accepts release and pre-release versions', () => {
    assert.equal(isValidPlaywrightVersion('1.62.0'), true);
    assert.equal(isValidPlaywrightVersion('1.50.0-beta'), true);
    assert.equal(isValidPlaywrightVersion('1.62.0-alpha-2026-07-23'), true);
  });

  it('rejects anything that is not an exact version', () => {
    assert.equal(isValidPlaywrightVersion(undefined), false);
    assert.equal(isValidPlaywrightVersion(''), false);
    assert.equal(isValidPlaywrightVersion('latest'), false);
    assert.equal(isValidPlaywrightVersion('1.62'), false);
    assert.equal(isValidPlaywrightVersion('^1.62.0'), false);
  });
});

describe('installPlaywrightVersion', () => {
  it('installs from the npm cache when the version resolves', async () => {
    const version = '1.60.0';
    const { freshnessFlags, installer } = recordingInstaller(async () => writeCli(version));

    const cliPath = await installPlaywrightVersion(version, installer);

    assert.equal(cliPath, cliPathOf(version));
    assert.deepEqual(freshnessFlags, ['--prefer-offline']);
  });

  it('retries online when cached registry metadata predates the release', async () => {
    const version = '1.62.0';
    const { freshnessFlags, installer } = recordingInstaller(async (attempt) => {
      if (attempt === 1) throw ETARGET_ERROR;
      await writeCli(version);
    });

    const cliPath = await installPlaywrightVersion(version, installer);

    assert.equal(cliPath, cliPathOf(version));
    assert.deepEqual(freshnessFlags, ['--prefer-offline', '--prefer-online']);
  });

  it('does not retry when the failure is unrelated to stale metadata', async () => {
    const version = '1.59.0';
    const { freshnessFlags, installer } = recordingInstaller(async () => {
      throw new Error('npm error code ENOTFOUND registry.npmjs.org');
    });

    await assert.rejects(
      installPlaywrightVersion(version, installer),
      /failed to install playwright@1\.59\.0.*ENOTFOUND/s
    );
    assert.deepEqual(freshnessFlags, ['--prefer-offline']);
    assert.equal(await pathExists(cacheDirOf(version)), false);
  });

  it('cleans up when the retry also fails', async () => {
    const version = '1.58.0';
    const { freshnessFlags, installer } = recordingInstaller(async () => {
      throw ETARGET_ERROR;
    });

    await assert.rejects(installPlaywrightVersion(version, installer), /ETARGET/);
    assert.deepEqual(freshnessFlags, ['--prefer-offline', '--prefer-online']);
    assert.equal(await pathExists(cacheDirOf(version)), false);
  });

  it('cleans up when the install reports success but leaves no CLI behind', async () => {
    const version = '1.57.0';
    const { installer } = recordingInstaller();

    await assert.rejects(installPlaywrightVersion(version, installer), /is missing/);
    assert.equal(await pathExists(cacheDirOf(version)), false);
  });
});

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

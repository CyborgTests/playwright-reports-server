import fs from 'node:fs/promises';
import path from 'node:path';

import { withError } from '../lib/withError';
import { SiteWhiteLabelConfig } from '../types';

import { defaultLinks } from './site';

export const defaultConfig: SiteWhiteLabelConfig = {
  title: 'Cyborg Tests',
  headerLinks: defaultLinks,
  logoPath: '/logo.svg',
  faviconPath: '/favicon.ico',
};

const configPath = './data/config.json';

export const noConfigErr = 'no config';

const isConfigValid = (config: any): config is SiteWhiteLabelConfig => {
  return (
    !!config &&
    typeof config === 'object' &&
    'title' in config &&
    'headerLinks' in config &&
    'logoPath' in config &&
    'faviconPath' in config
  );
};

// we need to check if logo or favicon images are available in public folder
// if not - copy from persisted data folder
const copyToPublicIfMissing = async (configPath: string) => {
  const fileName = path.basename(configPath);
  const publicPath = path.join('public', fileName);
  const { error } = await withError(fs.access(publicPath));

  const missingFile = error && error.message.includes('no such file');

  if (!missingFile) {
    return;
  }

  const persistancePath = path.join('data', fileName);

  await withError(fs.copyFile(persistancePath, publicPath));
};

export const getConfigWithError = async (): Promise<{ result?: SiteWhiteLabelConfig; error: Error | null }> => {
  const { error: accessConfigError } = await withError(fs.access(configPath));

  if (accessConfigError) {
    return { result: defaultConfig, error: new Error(noConfigErr) };
  }

  const { result, error } = await withError(fs.readFile(configPath, 'utf-8'));

  if (error || !result) {
    return { error };
  }

  try {
    const parsed = JSON.parse(result);

    const isValid = isConfigValid(parsed);

    if (isValid) {
      await copyToPublicIfMissing(parsed.logoPath);
      await copyToPublicIfMissing(parsed.faviconPath);
    }

    return isValid ? { result: parsed, error: null } : { error: new Error('invalid config') };
  } catch (e) {
    return { error: new Error(`failed to parse config: ${e instanceof Error ? e.message : e}`) };
  }
};

export const writeConfig = async (config: Partial<SiteWhiteLabelConfig>) => {
  const { result: existingConfig, error: configError } = await getConfigWithError();

  const isConfigFailed = !!configError && configError?.message !== noConfigErr && !existingConfig;

  if (isConfigFailed) {
    throw new Error(`failed to save config: ${configError.message}`);
  }

  const previousConfig = existingConfig ?? defaultConfig;

  return await withError(
    fs.writeFile(configPath, JSON.stringify({ ...previousConfig, ...config }, null, 2), { flag: 'w+' }),
  );
};

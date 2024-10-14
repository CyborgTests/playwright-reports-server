import fs from 'node:fs/promises';
import path from 'node:path';

import { withError } from '@/app/lib/withError';
import { SiteWhiteLabelConfig } from '@/app/types';
import { defaultLinks } from '@/app/config/site';
import { DATA_PATH } from '@/app/lib/storage/constants';

export const defaultConfig: SiteWhiteLabelConfig = {
  title: 'Cyborg Tests',
  headerLinks: defaultLinks,
  logoPath: '/logo.svg',
  faviconPath: '/favicon.ico',
};

const configPath = path.join(DATA_PATH, 'config.json');

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

import { storage } from '@/app/lib/storage';
import { isBuildStage } from '@/app/config/runtime';
import { env } from '@/app/config/env';
import { SiteWhiteLabelConfig } from '@/app/types';
import { defaultConfig } from '@/app/lib/config';

export class ConfigCache {
  private static instance: ConfigCache;
  public initialized = false;
  public config: SiteWhiteLabelConfig | undefined;

  private constructor() {}

  public static getInstance() {
    if (!ConfigCache.instance) {
      ConfigCache.instance = new ConfigCache();
    }

    return ConfigCache.instance;
  }

  public async init(): Promise<void> {
    if (this.initialized || !env.USE_SERVER_CACHE) {
      return;
    }

    console.log('[config cache] initializing cache');
    const { result, error } = await storage.readConfigFile();

    const cache = ConfigCache.getInstance();

    if (error) {
      console.error('[config cache] failed to read config file:', error);
      console.warn('[config cache] using default config');
    }

    cache.config = result || defaultConfig;
    console.log('[config cache] initialized with config:', cache.config);

    this.initialized = true;
  }

  public async onChanged(config: SiteWhiteLabelConfig) {
    if (!env.USE_SERVER_CACHE) {
      return;
    }

    this.config = config;
  }
}

export const configCache = ConfigCache.getInstance();

if (!configCache.initialized && !isBuildStage) {
  await configCache.init();
}

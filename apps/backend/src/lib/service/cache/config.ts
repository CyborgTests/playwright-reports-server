import type { SiteWhiteLabelConfig } from '@playwright-reports/shared';
import { siteConfigDb } from '../db/index.js';

const initiatedConfigDb = Symbol.for('playwright.reports.db.config');
const instance = globalThis as typeof globalThis & {
  [initiatedConfigDb]?: ConfigCache;
};

export class ConfigCache {
  public initialized = false;
  public config: SiteWhiteLabelConfig | undefined;

  private constructor() {}

  public static getInstance() {
    instance[initiatedConfigDb] ??= new ConfigCache();

    return instance[initiatedConfigDb];
  }

  public async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    siteConfigDb.ensureSeeded();
    this.config = siteConfigDb.get();
    this.initialized = true;
  }

  public onChanged(config: SiteWhiteLabelConfig) {
    this.config = config;
  }
}

export const configCache = ConfigCache.getInstance();

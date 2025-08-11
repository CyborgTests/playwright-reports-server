import { configCache, reportCache, resultCache } from '@/app/lib/service/cache';
import { cronService } from '@/app/lib/service/cron';
import { env } from '@/app/config/env';
import { isBuildStage } from '@/app/config/runtime';

const processKey = Symbol.for('playwright.reports.lifecycle');

export class Lifecycle {
  private initialized = false;
  private initPromise?: Promise<void>;

  public static getInstance(): Lifecycle {
    const nodeJsProcess = process as typeof process & { [key: symbol]: any };

    if (!nodeJsProcess[processKey]) {
      nodeJsProcess[processKey] = new Lifecycle();
    }

    return nodeJsProcess[processKey];
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;

    this.initPromise ??= this._performInitialization();

    return this.initPromise;
  }

  private async _performInitialization(): Promise<void> {
    console.log('[lifecycle] Starting application initialization');

    try {
      if (env.USE_SERVER_CACHE) {
        await Promise.all([configCache.init(), reportCache.init(), resultCache.init()]);
        console.log('[lifecycle] Caches initialized successfully');
      }

      if (!cronService.initialized && !isBuildStage) {
        await cronService.init();
        console.log('[lifecycle] Cron service initialized successfully');
      }

      this.initialized = true;
      console.log('[lifecycle] Application initialization complete');
    } catch (error) {
      console.error('[lifecycle] Initialization failed:', error);
      throw error;
    }
  }

  public isInitialized(): boolean {
    return this.initialized;
  }
}

export const lifecycle = Lifecycle.getInstance();

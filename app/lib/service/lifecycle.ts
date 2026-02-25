import { configCache } from '@/app/lib/service/cache/config';
import { reportDb, resultDb } from '@/app/lib/service/db';
import { cronService } from '@/app/lib/service/cron';
import { env } from '@/app/config/env';
import { isBuildStage } from '@/app/config/runtime';

const createdLifecycle = Symbol.for('playwright.reports.lifecycle');
const instance = globalThis as typeof globalThis & { [createdLifecycle]?: Lifecycle };

export class Lifecycle {
  private initialized = false;
  private initPromise?: Promise<void>;

  public static getInstance(): Lifecycle {
    instance[createdLifecycle] ??= new Lifecycle();

    return instance[createdLifecycle];
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
        await Promise.all([configCache.init(), reportDb.init(), resultDb.init()]);
        console.log('[lifecycle] Databases initialized successfully');
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

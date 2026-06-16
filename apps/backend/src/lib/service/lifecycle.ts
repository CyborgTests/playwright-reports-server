import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';
import { githubSyncCron } from '../githubSync/cronManager.js';
import { llmService } from '../llm/index.js';
import type { LLMProviderConfig } from '../llm/types/index.js';
import { TMP_FOLDER } from '../storage/constants.js';
import { initStorage, storage } from '../storage/index.js';
import { withError } from '../withError.js';
import { configCache } from './cache/config.js';
import { cronService } from './cron.js';
import { githubSyncDb, llmTasksDb, reportDb, resultDb, siteConfigDb } from './db/index.js';
import { getKysely } from './db/kysely.js';
import { migrateToLatest } from './db/migrations/index.js';
import { litestreamService } from './litestream.js';
import { notificationScheduler } from './notifications/scheduler.js';

const createdLifecycle = Symbol.for('playwright.reports.lifecycle');
const instance = globalThis as typeof globalThis & {
  [createdLifecycle]?: Lifecycle;
};

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
      // resolve the storage backend first - this lazily loads only the selected
      // SDK and must complete before any storage consumer runs.
      await initStorage();

      await litestreamService.preflight();
      const restored = await litestreamService.restoreIfNeeded();

      // Build/upgrade the schema and run seed migrations.
      // Must happen after any Litestream restore (which swaps the DB file) and before the first query.
      await migrateToLatest(getKysely());

      await Promise.all([configCache.init(), reportDb.init(), resultDb.init()]);
      if (!restored) {
        await reportDb.populateTestRuns();
      }
      console.log('[lifecycle] Databases initialized successfully');

      llmService.applyConfig(configCache.config?.llm as Partial<LLMProviderConfig> | undefined);

      if (env.DATA_STORAGE === 's3' || env.DATA_STORAGE === 'azure') {
        const cachePath = path.join(TMP_FOLDER, 'results');
        const { error: mkdirError } = await withError(fs.mkdir(cachePath, { recursive: true }));
        if (mkdirError) {
          console.warn(`[lifecycle] failed to create result cache dir: ${mkdirError.message}`);
        }
      }

      siteConfigDb.ensureSeeded();
      const cfg = siteConfigDb.get();
      const brandingCandidates: string[] = [];
      if (cfg.logoPath) brandingCandidates.push(cfg.logoPath);
      if (cfg.faviconPath) brandingCandidates.push(cfg.faviconPath);
      for (const link of cfg.headerLinks ?? []) {
        if (link.icon) brandingCandidates.push(link.icon);
      }
      for (const candidate of brandingCandidates) {
        if (!candidate.startsWith('/branding/')) continue;
        const { error } = await withError(storage.ensureBrandingAsset(candidate));
        if (error) {
          console.warn(
            `[lifecycle] failed to ensure branding asset ${candidate}: ${error.message}`
          );
        }
      }

      // Reap orphaned LLM tasks: any row stuck in `processing` is from a worker
      // (queue or SSE) that died before completing. Fail them so the queue page
      // doesn't show ghost-running tasks
      const reaped = llmTasksDb.failStaleProcessing();
      if (reaped > 0) {
        console.log(`[lifecycle] Failed ${reaped} stale processing LLM task(s) from prior run`);
      }

      await litestreamService.start();

      if (!cronService.initialized) {
        await cronService.init();
        console.log('[lifecycle] Cron service initialized successfully');
      }

      const reapedSyncRuns = githubSyncDb.failStaleRunning('process restarted');
      if (reapedSyncRuns > 0) {
        console.log(`[lifecycle] Failed ${reapedSyncRuns} stale GitHub sync run(s) from prior run`);
      }

      githubSyncCron.init();
      console.log('[lifecycle] GitHub sync cron initialized');

      try {
        notificationScheduler.reload(configCache.config?.notifications);
      } catch (err) {
        console.warn(
          `[lifecycle] notification scheduler reload failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
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

  public async cleanup(): Promise<void> {
    if (!this.initialized) return;

    console.log('[lifecycle] Starting application cleanup');

    try {
      if (cronService.initialized) {
        await cronService.stop();
        console.log('[lifecycle] Cron service stopped');
      }

      githubSyncCron.stop();

      try {
        notificationScheduler.stopAll();
      } catch (err) {
        console.warn(
          `[lifecycle] notification scheduler stop failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }

      await litestreamService.stop();

      console.log('[lifecycle] Application cleanup complete');
    } catch (error) {
      console.error('[lifecycle] Cleanup failed:', error);
    }
  }
}

export const lifecycle = Lifecycle.getInstance();

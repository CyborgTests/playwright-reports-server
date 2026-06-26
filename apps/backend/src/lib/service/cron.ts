import fs from 'node:fs/promises';
import path from 'node:path';
import { Cron } from 'croner';
import { env } from '../../config/env.js';
import { defaultCronConfig } from '../../lib/config.js';
import { withError } from '../../lib/withError.js';
import { TMP_FOLDER } from '../storage/constants.js';
import {
  authAuditDb,
  getDatabase,
  llmTasksDb,
  notificationLogDb,
  optimizeDB,
  resetTokensDb,
  sessionsDb,
} from './db/index.js';
import { service } from './index.js';

// Shared croner behavioural policy: `unref` so jobs never block process exit,
// `protect` so an overrun is skipped rather than overlapped. Logging/naming stays
// per-caller.
export function cronOptions(onError: (err: unknown) => void) {
  return { unref: true, protect: true, catch: onError };
}

const runningCron = Symbol.for('playwright.reports.cron.service');
const instance = globalThis as typeof globalThis & {
  [runningCron]?: CronService;
};

interface JobSpec {
  name: 'reports' | 'results';
  expireDays: number | undefined;
  expression: string | undefined;
  timeoutMs: number;
  task: () => Promise<void>;
}

export class CronService {
  public initialized = false;

  private jobs: Cron[] = [];
  private readonly inFlight = new Map<string, Promise<void>>();

  public static getInstance() {
    instance[runningCron] ??= new CronService();

    return instance[runningCron];
  }

  private constructor() {}

  public static validateExpression(expression: string): { valid: boolean; error?: string } {
    try {
      const probe = new Cron(expression, { paused: true });
      probe.stop();
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Invalid cron expression',
      };
    }
  }

  public async init() {
    if (this.initialized) {
      return;
    }
    await this.scheduleJobs();
    this.initialized = true;
  }

  public async restart() {
    console.log('[cron-job] restarting cron tasks...');
    this.stopJobs();
    await this.awaitInFlight(CronService.STOP_DEADLINE_MS);
    this.initialized = false;
    await this.init();
  }

  public async stop() {
    console.log('[cron-job] stopping cron tasks...');
    this.stopJobs();
    await this.awaitInFlight(CronService.STOP_DEADLINE_MS);
    this.initialized = false;
  }

  private stopJobs() {
    for (const job of this.jobs) job.stop();
    this.jobs = [];
  }

  private wrapJob(name: string, timeoutMs: number, task: () => Promise<void>): () => Promise<void> {
    return async () => {
      const promise = (async () => {
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`task timed out after ${timeoutMs}ms`));
          }, timeoutMs);
          timer.unref?.();
        });
        try {
          await Promise.race([task(), timeout]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      })();
      this.inFlight.set(name, promise);
      try {
        await promise;
      } finally {
        this.inFlight.delete(name);
      }
    };
  }

  private async awaitInFlight(deadlineMs: number): Promise<void> {
    if (this.inFlight.size === 0) return;
    const snapshot = Array.from(this.inFlight.entries());
    const names = snapshot.map(([n]) => n).join(', ');
    console.log(`[cron-job] waiting up to ${deadlineMs}ms for in-flight tasks: ${names}`);
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<'deadline'>((resolve) => {
      timer = setTimeout(() => resolve('deadline'), deadlineMs);
      timer.unref?.();
    });
    const completion = Promise.allSettled(snapshot.map(([, p]) => p)).then(() => 'done' as const);
    const result = await Promise.race([deadline, completion]);
    if (timer) clearTimeout(timer);
    if (result === 'deadline') {
      const remaining = Array.from(this.inFlight.keys()).join(', ');
      console.warn(`[cron-job] stop deadline reached, still running: ${remaining || '(none)'}`);
    }
  }

  private async scheduleJobs() {
    const cfg = await service.getConfig();
    const reportDays = cfg.cron?.reportExpireDays ?? defaultCronConfig.reportExpireDays;
    const resultDays = cfg.cron?.resultExpireDays ?? defaultCronConfig.resultExpireDays;
    const reportSchedule =
      cfg.cron?.reportExpireCronSchedule ?? defaultCronConfig.reportExpireCronSchedule;
    const resultSchedule =
      cfg.cron?.resultExpireCronSchedule ?? defaultCronConfig.resultExpireCronSchedule;

    console.log('[cron-job] scheduling cron tasks...');

    const usesObjectStorage = env.DATA_STORAGE === 's3' || env.DATA_STORAGE === 'azure';
    const fixed: Array<{
      name: string;
      expression: string;
      timeoutMs: number;
      task: () => Promise<void>;
      detail?: string;
      enabled?: boolean;
    }> = [
      {
        name: 'result-cache',
        expression: CronService.RESULT_CACHE_SCHEDULE,
        timeoutMs: CronService.RESULT_CACHE_TIMEOUT_MS,
        task: () => this.clearStaleResultCache(),
        detail: ` cleanup (older than ${CronService.RESULT_CACHE_TTL_MS / 60_000}m)`,
        enabled: usesObjectStorage,
      },
      {
        name: 'notification-log',
        expression: CronService.NOTIFICATION_LOG_SCHEDULE,
        timeoutMs: CronService.NOTIFICATION_LOG_TIMEOUT_MS,
        task: () => Promise.resolve(this.clearStaleNotificationLog()),
        detail: ` cleanup (older than ${CronService.NOTIFICATION_LOG_RETENTION_DAYS}d)`,
      },
      {
        name: 'db-maintenance',
        expression: CronService.DB_MAINTENANCE_SCHEDULE,
        timeoutMs: CronService.DB_MAINTENANCE_TIMEOUT_MS,
        task: () => Promise.resolve(this.runDbMaintenance()),
      },
      {
        name: 'storage-reconcile',
        expression: CronService.STORAGE_RECONCILE_SCHEDULE,
        timeoutMs: CronService.STORAGE_RECONCILE_TIMEOUT_MS,
        task: async () => {
          await service.reconcileStorageSizes();
        },
      },
      {
        // Auth GC only runs when auth is enabled — open mode must not touch auth tables.
        name: 'auth-gc',
        expression: CronService.AUTH_GC_SCHEDULE,
        timeoutMs: CronService.AUTH_GC_TIMEOUT_MS,
        task: () => Promise.resolve(this.runAuthGc()),
        enabled: !!env.API_TOKEN,
      },
    ];

    const candidates: Array<Cron | undefined> = [
      this.scheduleJob({
        name: 'reports',
        expireDays: reportDays,
        expression: reportSchedule,
        timeoutMs: CronService.CLEANUP_TIMEOUT_MS,
        task: () => this.runCleanup('reports'),
      }),
      this.scheduleJob({
        name: 'results',
        expireDays: resultDays,
        expression: resultSchedule,
        timeoutMs: CronService.CLEANUP_TIMEOUT_MS,
        task: () => this.runCleanup('results'),
      }),
      ...fixed
        .filter((f) => f.enabled !== false)
        .map((f) => this.buildCron(f.name, f.expression, f.timeoutMs, f.task, f.detail)),
    ];

    this.jobs = candidates.filter((c): c is Cron => c !== undefined);
  }

  private buildCron(
    name: string,
    expression: string,
    timeoutMs: number,
    task: () => Promise<void>,
    detail = ''
  ): Cron | undefined {
    const validation = CronService.validateExpression(expression);
    if (!validation.valid) {
      console.error(
        `[cron-job] ${name} has invalid cron expression "${expression}": ${validation.error}, skipping`
      );
      return undefined;
    }

    const job = new Cron(
      expression,
      cronOptions((err) => console.error(`[cron-job] ${name} task error:`, err)),
      this.wrapJob(name, timeoutMs, task)
    );

    const nextRun = job.nextRun();
    console.log(
      `[cron-job] scheduled ${name}${detail} at "${expression}", next run: ${nextRun?.toISOString() ?? 'unknown'}`
    );
    return job;
  }

  private runAuthGc() {
    const nowIso = new Date().toISOString();
    const sessions = sessionsDb.pruneExpiredSessions(nowIso);
    const resetTokens = resetTokensDb.pruneResetTokens(nowIso);
    const auditCutoff = this.cutoffISO(CronService.AUTH_AUDIT_RETENTION_DAYS);
    const audit = authAuditDb.pruneAuditOlderThan(auditCutoff);
    if (sessions + resetTokens + audit > 0) {
      console.log(
        `[cron-job] auth-gc pruned sessions=${sessions} resetTokens=${resetTokens} audit=${audit}`
      );
    }
  }

  private scheduleJob(spec: JobSpec): Cron | undefined {
    if (!spec.expireDays || spec.expireDays <= 0) {
      console.log(`[cron-job] ${spec.name} cleanup disabled (expireDays not set), skipping`);
      return undefined;
    }
    if (!spec.expression) {
      console.warn(
        `[cron-job] ${spec.name} cleanup has expireDays=${spec.expireDays} but no schedule expression, skipping`
      );
      return undefined;
    }
    return this.buildCron(
      spec.name,
      spec.expression,
      spec.timeoutMs,
      spec.task,
      ` cleanup (older than ${spec.expireDays}d)`
    );
  }

  private cutoffISO(days: number): string {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  private async runCleanup(kind: 'reports' | 'results'): Promise<void> {
    const cfg = await service.getConfig();
    const expireDays =
      kind === 'reports'
        ? (cfg.cron?.reportExpireDays ?? defaultCronConfig.reportExpireDays)
        : (cfg.cron?.resultExpireDays ?? defaultCronConfig.resultExpireDays);
    if (!expireDays || expireDays <= 0) return;

    const getIds = (cutoff: string, limit: number) =>
      kind === 'reports'
        ? service.getExpiredReportIds(cutoff, limit)
        : service.getExpiredResultIds(cutoff, limit);
    const deleteFn = (ids: string[]) =>
      kind === 'reports' ? service.deleteReports(ids) : service.deleteResults(ids);

    const cutoff = this.cutoffISO(expireDays);
    const batchSize = CronService.CLEANUP_BATCH_SIZE;
    let totalDeleted = 0;
    console.log(`[cron-job] starting outdated ${kind} cleanup (cutoff=${cutoff})`);

    while (true) {
      const ids = getIds(cutoff, batchSize);
      if (ids.length === 0) break;

      const { error } = await withError(deleteFn(ids));
      if (error) {
        console.error(`[cron-job] ${kind} cleanup batch failed after ${totalDeleted}: ${error}`);
        return;
      }

      totalDeleted += ids.length;
      if (ids.length < batchSize) break;
    }

    console.log(`[cron-job] outdated ${kind} cleanup finished, deleted ${totalDeleted}`);
  }

  private async clearStaleResultCache() {
    const cacheDir = path.join(TMP_FOLDER, 'results');
    const { result: entries, error: readError } = await withError(fs.readdir(cacheDir));
    if (readError || !entries) {
      // Dir may not exist yet on a fresh deploy that hasn't received an upload - non-fatal.
      return;
    }

    const cutoff = Date.now() - CronService.RESULT_CACHE_TTL_MS;
    let deleted = 0;

    for (const entry of entries) {
      const fullPath = path.join(cacheDir, entry);
      const { result: stats, error: statError } = await withError(fs.stat(fullPath));
      if (statError || !stats?.isFile()) continue;
      if (stats.mtimeMs >= cutoff) continue;

      const { error: unlinkError } = await withError(fs.unlink(fullPath));
      if (unlinkError) {
        console.warn(
          `[cron-job] failed to delete stale cache file ${entry}: ${unlinkError.message}`
        );
        continue;
      }
      deleted += 1;
    }

    if (deleted > 0) {
      console.log(`[cron-job] result-cache cleanup deleted ${deleted} stale file(s)`);
    }
  }

  private clearStaleNotificationLog() {
    const cutoff = Date.now() - CronService.NOTIFICATION_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const deleted = notificationLogDb.pruneOlderThan(cutoff);
    if (deleted > 0) {
      console.log(`[cron-job] notification-log cleanup deleted ${deleted} stale row(s)`);
    }
  }

  private runDbMaintenance() {
    const cutoff = this.cutoffISO(CronService.LLM_TASKS_RETENTION_DAYS);
    const prunedTasks = llmTasksDb.pruneCompletedOlderThan(cutoff);
    if (prunedTasks > 0) {
      console.log(`[cron-job] db-maintenance pruned ${prunedTasks} completed llm_tasks row(s)`);
    }

    optimizeDB();

    const checkpoint = getDatabase().pragma('wal_checkpoint(TRUNCATE)') as Array<{
      busy: number;
      log: number;
      checkpointed: number;
    }>;
    const cp = checkpoint[0];
    if (cp) {
      console.log(
        `[cron-job] db-maintenance wal_checkpoint busy=${cp.busy} log=${cp.log} checkpointed=${cp.checkpointed}`
      );
    }
  }

  private static readonly CLEANUP_BATCH_SIZE = 200;
  private static readonly RESULT_CACHE_SCHEDULE = '*/15 * * * *';
  private static readonly RESULT_CACHE_TTL_MS = 3 * 60 * 60 * 1000;
  private static readonly NOTIFICATION_LOG_SCHEDULE = '30 3 * * *';
  private static readonly NOTIFICATION_LOG_RETENTION_DAYS = 7;
  private static readonly DB_MAINTENANCE_SCHEDULE = '45 3 * * *';
  private static readonly STORAGE_RECONCILE_SCHEDULE = '15 4 * * *';
  private static readonly AUTH_GC_SCHEDULE = '0 4 * * *';
  private static readonly AUTH_AUDIT_RETENTION_DAYS = 90;
  private static readonly LLM_TASKS_RETENTION_DAYS = 30;
  private static readonly CLEANUP_TIMEOUT_MS = 60 * 60 * 1000; // 1h, batched DB+storage deletes
  private static readonly RESULT_CACHE_TIMEOUT_MS = 10 * 60 * 1000; // 10m, dir scan
  private static readonly NOTIFICATION_LOG_TIMEOUT_MS = 5 * 60 * 1000; // 5m, single DB delete
  private static readonly DB_MAINTENANCE_TIMEOUT_MS = 10 * 60 * 1000; // 10m, vacuum + checkpoint
  private static readonly STORAGE_RECONCILE_TIMEOUT_MS = 30 * 60 * 1000; // 30m, N HEAD checks
  private static readonly AUTH_GC_TIMEOUT_MS = 5 * 60 * 1000; // 5m, a few DB deletes
  private static readonly STOP_DEADLINE_MS = 30 * 1000;
}

export const cronService = CronService.getInstance();

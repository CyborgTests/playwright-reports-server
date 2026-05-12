import { Cron } from 'croner';
import { CronService } from '../service/cron.js';
import { withError } from '../withError.js';
import { githubSyncConfigService } from './configService.js';
import { runSync } from './syncService.js';

const initiated = Symbol.for('playwright.reports.githubSync.cron');
const instance = globalThis as typeof globalThis & {
  [initiated]?: GithubSyncCronManager;
};

class GithubSyncCronManager {
  private readonly jobs = new Map<string, Cron>();
  private initialized = false;

  public static getInstance(): GithubSyncCronManager {
    instance[initiated] ??= new GithubSyncCronManager();
    return instance[initiated];
  }

  public init(): void {
    if (this.initialized) return;
    this.initialized = true;
    for (const cfg of githubSyncConfigService.list()) {
      this.scheduleIfEnabled(cfg.id);
    }
  }

  public stop(): void {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
    this.initialized = false;
  }

  /** Re-reads the config row by id, unschedules any existing job, and
   *  schedules a new one if the config is enabled. */
  public scheduleIfEnabled(id: string): void {
    this.unschedule(id);
    const cfg = githubSyncConfigService.get(id);
    if (!cfg || !cfg.enabled) return;

    const validation = CronService.validateExpression(cfg.cronSchedule);
    if (!validation.valid) {
      console.error(
        `[github-sync-cron] config "${cfg.name}" has invalid schedule "${cfg.cronSchedule}": ${validation.error}`
      );
      return;
    }

    const job = new Cron(
      cfg.cronSchedule,
      {
        unref: true,
        protect: true,
        catch: (err) => console.error(`[github-sync-cron] ${cfg.name} task error:`, err),
      },
      async () => {
        const resolved = githubSyncConfigService.getResolved(id);
        if (!resolved || !resolved.enabled) return;
        const { error } = await withError(runSync(resolved, 'cron'));
        if (error) {
          console.error(`[github-sync-cron] ${resolved.name} run failed: ${error.message}`);
        }
      }
    );

    this.jobs.set(id, job);
    const nextRun = job.nextRun();
    console.log(
      `[github-sync-cron] scheduled "${cfg.name}" at "${cfg.cronSchedule}", next run: ${nextRun?.toISOString() ?? 'unknown'}`
    );
  }

  public unschedule(id: string): void {
    const existing = this.jobs.get(id);
    if (existing) {
      existing.stop();
      this.jobs.delete(id);
    }
  }

  public nextRun(id: string): string | undefined {
    return this.jobs.get(id)?.nextRun()?.toISOString();
  }
}

export const githubSyncCron = GithubSyncCronManager.getInstance();

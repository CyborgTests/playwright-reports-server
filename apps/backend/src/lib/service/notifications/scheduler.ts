import type {
  NotificationChannel,
  NotificationsConfig,
  ScheduleRule,
} from '@playwright-reports/shared';
import { Cron } from 'croner';
import { configCache } from '../cache/config.js';
import { CronService } from '../cron.js';
import { notificationStateDb } from '../db/index.js';
import { dispatchOne, writeLog } from './dispatch-helpers.js';
import type { DispatchResult } from './providers/types.js';
import {
  activeProjectsForWindow,
  buildSummaryForProject,
  cadenceToCron,
  createReportsWindowCache,
  resolveDiscoveryWindow,
  resolveWindow,
} from './schedule.js';
import { buildScheduleContext, scheduleConditionMatches, scheduleVariables } from './variables.js';

const schedulerSymbol = Symbol.for('playwright.reports.notifications.scheduler');
const instance = globalThis as typeof globalThis & {
  [schedulerSymbol]?: NotificationScheduler;
};

interface ActiveJob {
  channelId: string;
  ruleId: string;
  expression: string;
  cron: Cron;
}

export class NotificationScheduler {
  private jobs: ActiveJob[] = [];

  public static getInstance(): NotificationScheduler {
    instance[schedulerSymbol] ??= new NotificationScheduler();
    return instance[schedulerSymbol];
  }

  private constructor() {}

  public reload(config: NotificationsConfig | undefined): void {
    this.stopAll();
    if (!config?.enabled) return;

    for (const channel of config.channels) {
      if (!channel.enabled) continue;
      for (const rule of channel.rules) {
        if (rule.kind !== 'schedule') continue;
        if (rule.enabled === false) continue;
        this.registerOne(channel, rule);
      }
    }

    if (this.jobs.length > 0) {
      console.log(`[notifications] scheduled ${this.jobs.length} rule(s)`);
    }
  }

  public stopAll(): void {
    for (const job of this.jobs) {
      try {
        job.cron.stop();
      } catch (err) {
        console.warn(
          `[notifications] failed to stop job ${job.channelId}/${job.ruleId}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
    this.jobs = [];
  }

  private registerOne(channel: NotificationChannel, rule: ScheduleRule): void {
    const expression = cadenceToCron(rule);
    const validation = CronService.validateExpression(expression);
    if (!validation.valid) {
      console.warn(
        `[notifications] invalid cron "${expression}" for rule ${rule.id}: ${validation.error}, skipping`
      );
      return;
    }

    const cron = new Cron(
      expression,
      {
        unref: true,
        protect: true,
        catch: (err) =>
          console.error(`[notifications] schedule task error on ${channel.name}/${rule.id}:`, err),
      },
      () => this.fire(channel, rule)
    );

    const next = cron.nextRun();
    console.log(
      `[notifications] registered schedule rule ${channel.name}/${rule.id} "${expression}" next=${
        next?.toISOString() ?? 'unknown'
      }`
    );

    this.jobs.push({ channelId: channel.id, ruleId: rule.id, expression, cron });
  }

  private async fire(channel: NotificationChannel, rule: ScheduleRule): Promise<void> {
    try {
      const now = Date.now();
      const reportsCache = createReportsWindowCache();
      const discoveryWindow = resolveDiscoveryWindow(rule, now);
      const projects = activeProjectsForWindow(rule.projectFilter, discoveryWindow, reportsCache);

      if (projects.length === 0) {
        const skipped: DispatchResult = {
          ok: false,
          attempts: 0,
          skipReason: 'no_activity',
        };
        writeLog(channel, rule, skipped, 'live');
        return;
      }

      for (const project of projects) {
        const window = resolveWindow(rule, channel.id, project, now);
        const summary = buildSummaryForProject({ rule, project, window, cache: reportsCache });

        if (!scheduleConditionMatches(rule.condition, summary)) {
          const skipped: DispatchResult = {
            ok: false,
            attempts: 0,
            skipReason: 'condition_unmet',
          };
          writeLog(channel, rule, skipped, 'live');
          continue;
        }

        const context = buildScheduleContext({
          summary,
          serverUrl: configCache.config?.serverBaseUrl ?? '',
        });
        const allowlist = scheduleVariables();

        const result = await dispatchOne(channel, rule, context, allowlist);
        writeLog(channel, rule, result, 'live');
        if (result.ok) {
          notificationStateDb.recordFire(channel.id, rule.id, project, now);
        }
      }
    } catch (err) {
      console.error(
        `[notifications] uncaught error in scheduled fire ${channel.id}/${rule.id}:`,
        err
      );
    }
  }
}

export const notificationScheduler = NotificationScheduler.getInstance();

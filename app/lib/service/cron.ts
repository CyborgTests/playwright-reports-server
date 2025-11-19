import { Cron } from 'croner';

import { service } from '@/app/lib/service';
import { env } from '@/app/config/env';
import { withError } from '@/app/lib/withError';

const runningCron = Symbol.for('playwright.reports.cron.service');
const instance = globalThis as typeof globalThis & { [runningCron]?: CronService };

export class CronService {
  public initialized = false;

  private clearResultsJob: Cron | undefined;
  private clearReportsJob: Cron | undefined;

  public static getInstance() {
    instance[runningCron] ??= new CronService();

    return instance[runningCron];
  }

  private constructor() {
    this.clearResultsJob = this.clearResultsTask();
    this.clearReportsJob = this.clearReportsTask();
  }

  public async restart() {
    console.log('[cron-job] restarting cron tasks...');

    // Stop existing jobs
    this.clearResultsJob?.stop();
    this.clearReportsJob?.stop();

    // Recreate jobs with new settings
    this.clearResultsJob = this.clearResultsTask();
    this.clearReportsJob = this.clearReportsTask();

    // Reinitialize
    this.initialized = false;
    await this.init();
  }

  private isExpired(date: Date, days: number) {
    const millisecondsDays = days * 24 * 60 * 60 * 1000;

    return date.getTime() < Date.now() - millisecondsDays;
  }

  public async init() {
    if (this.initialized) {
      return;
    }
    const cfg = await service.getConfig();
    const reportExpireDays = cfg.cron?.reportExpireDays || env.REPORT_EXPIRE_DAYS;
    const resultExpireDays = cfg.cron?.resultExpireDays || env.RESULT_EXPIRE_DAYS;
    const reportExpireCronSchedule = cfg.cron?.reportExpireCronSchedule || env.REPORT_EXPIRE_CRON_SCHEDULE;
    const resultExpireCronSchedule = cfg.cron?.resultExpireCronSchedule || env.RESULT_EXPIRE_CRON_SCHEDULE;

    console.log(`[cron-job] initiating cron tasks...`);
    for (const schedule of [
      {
        name: 'reports',
        cron: this.clearReportsJob,
        expireDays: reportExpireDays,
        expression: reportExpireCronSchedule,
      },
      {
        name: 'results',
        cron: this.clearResultsJob,
        expireDays: resultExpireDays,
        expression: resultExpireCronSchedule,
      },
    ]) {
      const message = schedule.cron
        ? `found expiration task for ${schedule.name} older than ${schedule.expireDays} day(s) at "${schedule.expression}", starting...`
        : `no expiration task for ${schedule.name}, skipping...`;

      console.log(`[cron-job] ${message}`);

      if (!schedule.cron) {
        continue;
      }

      if (schedule.cron.isRunning()) {
        continue;
      }

      schedule.cron?.resume();
    }

    this.initialized = true;
  }

  private createJob(scheduleExpression: string, task: () => Promise<void>) {
    return new Cron(scheduleExpression, { catch: true, unref: true, paused: true, protect: true }, task);
  }

  private clearReportsTask() {
    const expireDays = env.REPORT_EXPIRE_DAYS;

    if (!expireDays) {
      return;
    }

    const scheduleExpression = env.REPORT_EXPIRE_CRON_SCHEDULE;

    return this.createJob(scheduleExpression, async () => {
      const cfg = await service.getConfig();
      const expireDays = cfg.cron?.reportExpireDays || env.REPORT_EXPIRE_DAYS;

      console.log('[cron-job] starting outdated reports lookup...');
      const reportsOutput = await service.getReports();

      const outdated = reportsOutput.reports.filter((report) => {
        const createdDate = typeof report.createdAt === 'string' ? new Date(report.createdAt) : report.createdAt;

        return expireDays ? this.isExpired(createdDate, expireDays) : false;
      });

      console.log(`[cron-job] found ${outdated.length} outdated reports`);

      const outdatedIds = outdated.map((report) => report.reportID);

      const { error } = await withError(service.deleteReports(outdatedIds));

      if (error) console.error(`[cron-job] error deleting outdated results: ${error}`);
    });
  }

  private clearResultsTask() {
    const expireDays = env.RESULT_EXPIRE_DAYS;

    if (!expireDays) {
      return;
    }
    const scheduleExpression = env.RESULT_EXPIRE_CRON_SCHEDULE;

    return this.createJob(scheduleExpression, async () => {
      const cfg = await service.getConfig();
      const expireDays = cfg.cron?.resultExpireDays || env.RESULT_EXPIRE_DAYS;

      console.log('[cron-job] starting outdated results lookup...');
      const resultsOutput = await service.getResults();

      const outdated = resultsOutput.results
        .map((result) => ({ ...result, createdDate: new Date(result.createdAt) }))
        .filter((result) => (expireDays ? this.isExpired(result.createdDate, expireDays) : false));

      console.log(`[cron-job] found ${outdated.length} outdated results`);

      const outdatedIds = outdated.map((result) => result.resultID);

      const { error } = await withError(service.deleteResults(outdatedIds));

      if (error) console.error(`[cron-job] error deleting outdated results: ${error}`);
    });
  }
}

export const cronService = CronService.getInstance();

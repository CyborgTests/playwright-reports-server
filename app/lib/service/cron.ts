import { Cron } from 'croner';

import { service } from '@/app/lib/service';
import { isBuildStage } from '@/app/config/runtime';
import { env } from '@/app/config/env';
import { withError } from '@/app/lib/withError';

export class CronService {
  private static instance: CronService;
  public initialized = false;

  private readonly clearResultsJob: Cron | undefined;
  private readonly clearReportsJob: Cron | undefined;

  public static getInstance() {
    if (!CronService.instance) {
      CronService.instance = new CronService();
    }

    return CronService.instance;
  }

  private constructor() {
    this.clearResultsJob = this.clearResultsTask();
    this.clearReportsJob = this.clearReportsTask();
  }

  private isExpired(date: Date, days: number) {
    const millisecondsDays = days * 24 * 60 * 60 * 1000;

    return date.getTime() < Date.now() - millisecondsDays;
  }

  public async init() {
    if (this.initialized) {
      return;
    }

    console.log(`[cron-job] initiating cron tasks...`);
    for (const schedule of [
      {
        name: 'reports',
        cron: this.clearReportsJob,
      },
      {
        name: 'results',
        cron: this.clearResultsJob,
      },
    ]) {
      const message = schedule.cron
        ? `found expiration task for ${schedule.name}, starting...`
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

    return this.createJob(env.REPORT_EXPIRE_CRON_SCHEDULE, async () => {
      console.log('[cron-job] starting outdated reports lookup...');
      const reportsOutput = await service.getReports();

      const outdated = reportsOutput.reports.filter((report) => this.isExpired(report.createdAt, expireDays));

      console.log(`[cron-job] found ${outdated.length} outdated reports`);

      const outDatedIds = outdated.map((report) => report.reportID);

      const { error } = await withError(service.deleteReports(outDatedIds));

      if (error) console.error(`[cron-job] error deleting outdated results: ${error}`);
    });
  }

  private clearResultsTask() {
    const expireDays = env.RESULT_EXPIRE_DAYS;

    if (!expireDays) {
      return;
    }

    return this.createJob(env.RESULT_EXPIRE_CRON_SCHEDULE, async () => {
      console.log('[cron-job] starting outdated results lookup...');
      const resultsOutput = await service.getResults();

      const outdated = resultsOutput.results
        .map((result) => ({ ...result, createdDate: new Date(result.createdAt) }))
        .filter((result) => this.isExpired(result.createdDate, expireDays));

      console.log(`[cron-job] found ${outdated.length} outdated results`);

      const outDatedIds = outdated.map((result) => result.resultID);

      const { error } = await withError(service.deleteResults(outDatedIds));

      if (error) console.error(`[cron-job] error deleting outdated results: ${error}`);
    });
  }
}

export const cronService = CronService.getInstance();

if (!cronService.initialized && !isBuildStage) {
  await cronService.init();
}

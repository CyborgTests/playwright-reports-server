import path from 'node:path';

import { storage } from '@/app/lib/storage';
import { type Report, type ReportHistory } from '@/app/lib/storage/types';
import { withError } from '@/app/lib/withError';
import { processBatch } from '@/app/lib/storage/batch';
import { env } from '@/app/config/env';
import { parse } from '@/app/lib/parser';
import { isBuildStage } from '@/app/config/runtime';

type ReportsMap = Map<string, ReportHistory>;

export class ReportCache {
  private static instance: ReportCache;
  public initialized = false;
  private readonly reports: ReportsMap;

  private constructor() {
    this.reports = new Map();
  }

  public static getInstance() {
    if (!ReportCache.instance) {
      ReportCache.instance = new ReportCache();
    }

    return ReportCache.instance;
  }

  private async getStats(report: Report): Promise<ReportHistory> {
    const { result: html, error } = await withError(
      storage.readFile(path.join(report?.project ?? '', report.reportID, 'index.html'), 'text/html'),
    );

    if (error || !html) {
      return report as ReportHistory;
    }

    const { result: info, error: parseError } = await withError(parse(html as string));

    if (parseError || !info) {
      return report as ReportHistory;
    }

    return {
      ...report,
      ...info,
    };
  }

  public async init() {
    if (this.initialized || !env.USE_SERVER_CACHE) {
      return;
    }

    console.log('[report cache] initializing cache');
    const { reports } = await storage.readReports();

    const withStats = await processBatch<Report, ReportHistory>({}, reports, env.S3_BATCH_SIZE ?? 10, this.getStats);

    for (const report of withStats) {
      ReportCache.getInstance().reports.set(report.reportID, report);
    }

    this.initialized = true;
  }

  public async onDeleted(reportIds: string[]) {
    for (const id of reportIds) {
      this.reports.delete(id);
    }
  }

  public async onCreated(report: ReportHistory) {
    this.reports.set(report.reportID, report);
  }

  public getAll(): ReportHistory[] {
    return Array.from(this.reports.values());
  }

  public getByID(reportID: string): ReportHistory | undefined {
    return this.reports.get(reportID);
  }
}

export const reportCache = ReportCache.getInstance();

if (!reportCache.initialized && !isBuildStage) {
  await reportCache.init();
}

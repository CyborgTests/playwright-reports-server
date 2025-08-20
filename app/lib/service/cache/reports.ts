import { storage } from '@/app/lib/storage';
import { type ReportHistory } from '@/app/lib/storage/types';
import { env } from '@/app/config/env';
import { withError } from '../../withError';

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

  public async init() {
    if (this.initialized || !env.USE_SERVER_CACHE) {
      return;
    }

    console.log('[report cache] initializing cache');
    const { result, error } = await withError(storage.readReports());

    if (error) {
      console.error('[report cache] failed to read reports:', error);

      return;
    }

    if (!result?.reports?.length) {
      return;
    }

    for (const report of result.reports) {
      ReportCache.getInstance().reports.set(report.reportID, report);
    }

    this.initialized = true;
  }

  public onDeleted(reportIds: string[]) {
    if (!env.USE_SERVER_CACHE) {
      return;
    }

    for (const id of reportIds) {
      this.reports.delete(id);
    }
  }

  public onCreated(report: ReportHistory) {
    if (!env.USE_SERVER_CACHE) {
      return;
    }
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

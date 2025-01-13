import { withError } from '../withError';
import { bytesToString, getUniqueProjectsList } from '../storage/format';

import { reportCache, resultCache } from './cache';

import {
  type ReadReportsInput,
  ReadResultsInput,
  ReadResultsOutput,
  ReportHistory,
  ReportMetadata,
  ResultDetails,
  ServerDataInfo,
  isReportHistory,
  storage,
} from '@/app/lib/storage';
import { handlePagination } from '@/app/lib/storage/pagination';
import { UUID } from '@/app/types';

class Service {
  private static instance: Service;

  public static getInstance() {
    console.log(`[service] get instance`);
    if (!Service.instance) {
      Service.instance = new Service();

      // register cleanup cron jobs
      import('@/app/lib/service/cron');
    }

    return Service.instance;
  }

  public async getReports(input?: ReadReportsInput) {
    console.log(`[service] getReports`);
    const cached = reportCache.getAll();

    const shouldUseCache = !input?.ids;

    if (cached.length && shouldUseCache) {
      console.log(`[service] using cached reports`);
      const noFilters = !input?.project && !input?.ids;
      const shouldFilterByProject = (report: ReportHistory) => input?.project && report.project === input.project;
      const shouldFilterByID = (report: ReportHistory) => input?.ids?.includes(report.reportID);

      const reports = cached.filter((report) => noFilters || shouldFilterByProject(report) || shouldFilterByID(report));

      const getTimestamp = (date?: Date) => date?.getTime() ?? 0;

      reports.sort((a, b) => getTimestamp(b.createdAt) - getTimestamp(a.createdAt));
      const currentReports = handlePagination<ReportHistory>(reports, input?.pagination);

      return {
        reports: currentReports,
        total: reports.length,
      };
    }

    console.log(`[service] using external reports`);

    return await storage.readReports(input);
  }

  public async getReport(id: string): Promise<ReportHistory> {
    console.log(`[service] getReport ${id}`);
    const cached = reportCache.getByID(id);

    if (isReportHistory(cached)) {
      console.log(`[service] using cached report`);

      return cached;
    }

    console.log(`[service] fetching report`);

    const { reports } = await this.getReports({ ids: [id] });

    const report = reports.find((report) => report.reportID === id);

    if (!report) {
      throw new Error(`report with id ${id} not found`);
    }

    return report;
  }

  public async generateReport(resultsIds: string[], metadata?: ReportMetadata): Promise<string> {
    const reportId = await storage.generateReport(resultsIds, metadata);

    const report = await this.getReport(reportId);

    reportCache.onCreated(report);

    return report.reportID;
  }

  public async deleteReports(reportIDs: string[]) {
    const { error } = await withError(storage.deleteReports(reportIDs));

    if (error) {
      throw error;
    }

    reportCache.onDeleted(reportIDs);
  }

  public async getReportsProjects(): Promise<string[]> {
    const { reports } = await this.getReports();
    const projects = getUniqueProjectsList(reports);

    return projects;
  }

  public async getResults(input?: ReadResultsInput): Promise<ReadResultsOutput> {
    console.log(`[results service] getResults`);
    const cached = resultCache.getAll();

    if (cached.length) {
      const getTimestamp = (date?: Date) => date?.getTime() ?? 0;

      cached.sort((a, b) => getTimestamp(new Date(b.createdAt)) - getTimestamp(new Date(a.createdAt)));

      const byProject = input?.project
        ? cached.filter((file) => (input?.project ? file.project === input.project : file))
        : cached;

      const results = !input?.pagination ? byProject : handlePagination(byProject, input?.pagination);

      return {
        results,
        total: byProject.length,
      };
    }

    return await storage.readResults(input);
  }

  public async deleteResults(resultIDs: string[]): Promise<void> {
    const { error } = await withError(storage.deleteResults(resultIDs));

    if (error) {
      throw error;
    }

    resultCache.onDeleted(resultIDs);
  }

  public async saveResult(
    file: Blob,
    size: number,
    resultDetails: ResultDetails,
  ): Promise<{
    resultID: UUID;
    createdAt: string;
    size: string;
    sizeBytes: number;
  }> {
    const result = await storage.saveResult(file, size, resultDetails);

    resultCache.onCreated(result);

    return result;
  }

  public async getResultsProjects(): Promise<string[]> {
    const { results } = await this.getResults();
    const projects = getUniqueProjectsList(results);

    const reportProjects = await this.getReportsProjects();

    return Array.from(new Set([...projects, ...reportProjects]));
  }

  public async getServerInfo(): Promise<ServerDataInfo> {
    console.log(`[service] getServerInfo`);
    const canCalculateFromCache = reportCache.initialized && resultCache.initialized;

    if (!canCalculateFromCache) {
      return await storage.getServerDataInfo();
    }

    const reports = reportCache.getAll();
    const results = resultCache.getAll();

    const getTotalSizeBytes = <T extends { sizeBytes: number }[]>(entity: T) =>
      entity.reduce((total, item) => total + item.sizeBytes, 0);

    const reportsFolderSize = getTotalSizeBytes(reports);
    const resultsFolderSize = getTotalSizeBytes(results);
    const dataFolderSize = reportsFolderSize + resultsFolderSize;

    return {
      dataFolderSizeinMB: bytesToString(dataFolderSize),
      numOfResults: results.length,
      resultsFolderSizeinMB: bytesToString(resultsFolderSize),
      numOfReports: reports.length,
      reportsFolderSizeinMB: bytesToString(reportsFolderSize),
    };
  }
}

export const service = Service.getInstance();

import path from 'node:path';

import { withError } from '../withError';
import { getUniqueProjectsList } from '../storage/format';

import { reportCache } from './cache';

import { type ReadReportsInput, ReportHistory, storage } from '@/app/lib/storage';
import { parse } from '@/app/lib/parser';
import { handlePagination } from '@/app/lib/storage/pagination';

const isReportHistory = (report: any): report is ReportHistory => !!report && 'stats' in report;

class ReportsService {
  private static instance: ReportsService;

  public static getInstance() {
    console.log(`[reports service] get instance`);
    if (!ReportsService.instance) {
      ReportsService.instance = new ReportsService();
    }

    return ReportsService.instance;
  }

  public async getReports(input?: ReadReportsInput) {
    console.log(`[reports service] getReports`);
    const cached = reportCache.getAll();

    const shouldUseCache = !input || !input.ids;

    if (cached.length && shouldUseCache) {
      console.log(`[reports service] using cached reports`);
      const noFilters = !input?.project && !input?.ids;
      const shouldFilterByProject = (report: ReportHistory) => input?.project && report.project === input.project;
      const shouldFilterByID = (report: ReportHistory) => input?.ids && input.ids.includes(report.reportID);

      const reports = cached.filter((report) => noFilters || shouldFilterByProject(report) || shouldFilterByID(report));

      const getTimestamp = (date?: Date) => date?.getTime() ?? 0;

      reports.sort((a, b) => getTimestamp(b.createdAt) - getTimestamp(a.createdAt));
      const currentReports = handlePagination<ReportHistory>(reports, input?.pagination);

      return {
        reports: currentReports,
        total: cached.length,
      };
    }

    console.log(`[reports service] using external reports`);

    return await storage.readReports(input);
  }

  public async getReport(id: string): Promise<ReportHistory> {
    console.log(`[reports service] getReport ${id}`);
    const cached = reportCache.getByID(id);

    if (isReportHistory(cached)) {
      console.log(`[reports service] using cached report`);

      return cached;
    }

    console.log(`[reports service] fetching report`);

    const { reports } = await this.getReports({ ids: [id] });

    const report = reports.find((report) => report.reportID === id);

    if (!report) {
      throw new Error(`report with id ${id} not found`);
    }

    if (isReportHistory(report)) {
      return report;
    }

    const { result: html, error: readHtmlError } = await withError(
      storage.readFile(path.join(report?.project ?? '', id, 'index.html'), 'text/html'),
    );

    if (readHtmlError || !html) {
      throw new Error(`failed to read report html file: ${readHtmlError?.message ?? 'unknown error'}`);
    }

    const { result: info, error: parseError } = await withError(parse(html as string));

    if (parseError || !info) {
      throw new Error(`failed to parse report html file: ${parseError?.message ?? 'unknown error'}`);
    }

    return { ...report!, ...info };
  }

  public async generateReport(resultsIds: string[], project?: string): Promise<string> {
    const reportId = await storage.generateReport(resultsIds, project);

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

    return;
  }

  public async getReportsProjects(): Promise<string[]> {
    const { reports } = await this.getReports();
    const projects = getUniqueProjectsList(reports);

    return projects;
  }
}

export const reportService = ReportsService.getInstance();

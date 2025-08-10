import { PassThrough, Readable } from 'node:stream';

import { withError } from '../withError';
import { bytesToString, getUniqueProjectsList } from '../storage/format';
import { serveReportRoute } from '../constants';
import { DEFAULT_STREAM_CHUNK_SIZE } from '../storage/constants';

import { configCache, reportCache, resultCache } from './cache';

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
import { SiteWhiteLabelConfig } from '@/app/types';
import { defaultConfig } from '@/app/lib/config';
import { env } from '@/app/config/env';
import { type S3 } from '@/app/lib/storage/s3';

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

      let reports = cached.filter((report) => noFilters || shouldFilterByProject(report) || shouldFilterByID(report));

      // Filter by search if provided
      if (input?.search?.trim()) {
        const searchTerm = input.search.toLowerCase().trim();

        reports = reports.filter((report) => {
          // Search in title, reportID, project, and all metadata fields
          const searchableFields = [
            report.title,
            report.reportID,
            report.project,
            ...Object.entries(report)
              .filter(
                ([key]) =>
                  !['reportID', 'title', 'createdAt', 'size', 'sizeBytes', 'project', 'reportUrl', 'stats'].includes(
                    key,
                  ),
              )
              .map(([key, value]) => `${key}: ${value}`),
          ].filter(Boolean);

          return searchableFields.some((field) => field?.toLowerCase().includes(searchTerm));
        });
      }

      const getTimestamp = (date?: Date | string) => {
        if (!date) return 0;
        if (typeof date === 'string') return new Date(date).getTime();

        return date.getTime();
      };

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

  public async generateReport(
    resultsIds: string[],
    metadata?: ReportMetadata,
  ): Promise<{ reportId: string; reportUrl: string; metadata: ReportMetadata }> {
    const reportId = await storage.generateReport(resultsIds, metadata);

    const report = await this.getReport(reportId);

    reportCache.onCreated(report);

    const projectPath = metadata?.project ? `${encodeURI(metadata.project)}/` : '';
    const reportUrl = `${serveReportRoute}/${projectPath}${reportId}/index.html`;

    return { reportId, reportUrl, metadata: metadata ?? {} };
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
      const getTimestamp = (date?: Date | string) => {
        if (!date) return 0;
        if (typeof date === 'string') return new Date(date).getTime();

        return date.getTime();
      };

      cached.sort((a, b) => getTimestamp(b.createdAt) - getTimestamp(a.createdAt));

      let filtered = input?.project
        ? cached.filter((file) => (input?.project ? file.project === input.project : file))
        : cached;

      if (input?.testRun) {
        filtered = filtered.filter((file) => file.testRun === input.testRun);
      }

      // Filter by tags if provided
      if (input?.tags && input.tags.length > 0) {
        const notMetadataKeys = ['resultID', 'title', 'createdAt', 'size', 'sizeBytes', 'project'];

        filtered = filtered.filter((result) => {
          const resultTags = Object.entries(result)
            .filter(([key]) => !notMetadataKeys.includes(key))
            .map(([key, value]) => `${key}: ${value}`);

          return input.tags!.some((selectedTag) => resultTags.includes(selectedTag));
        });
      }

      // Filter by search if provided
      if (input?.search && input.search.trim()) {
        const searchTerm = input.search.toLowerCase().trim();

        filtered = filtered.filter((result) => {
          // Search in title, resultID, project, and all metadata fields
          const searchableFields = [
            result.title,
            result.resultID,
            result.project,
            ...Object.entries(result)
              .filter(([key]) => !['resultID', 'title', 'createdAt', 'size', 'sizeBytes', 'project'].includes(key))
              .map(([key, value]) => `${key}: ${value}`),
          ].filter(Boolean);

          return searchableFields.some((field) => field?.toLowerCase().includes(searchTerm));
        });
      }

      const results = !input?.pagination ? filtered : handlePagination(filtered, input?.pagination);

      return {
        results,
        total: filtered.length,
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

  public async getPresignedUrl(fileName: string): Promise<string | undefined> {
    console.log(`[service] getPresignedUrl for ${fileName}`);
    if (env.DATA_STORAGE === 's3') {
      console.log(`[service] s3 detected, generating presigned URL`);

      const { result: presignedUrl, error } = await withError((storage as S3).generatePresignedUploadUrl(fileName));

      if (error) {
        console.error(`[service] getPresignedUrl | error: ${error.message}`);

        return '';
      }

      return presignedUrl!;
    }

    console.log(`[service] fs storage detected, no presigned URL needed`);

    return '';
  }

  public async saveResult(filename: string, stream: PassThrough, presignedUrl?: string, contentLength?: string) {
    if (!presignedUrl) {
      console.log(`[service] saving result`);

      return await storage.saveResult(filename, stream);
    }

    console.log(`[service] using direct upload via presigned URL`, presignedUrl);

    const { error } = await withError(
      fetch(presignedUrl, {
        method: 'PUT',
        body: Readable.toWeb(stream, {
          strategy: {
            highWaterMark: DEFAULT_STREAM_CHUNK_SIZE,
          },
        }),
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': contentLength,
        },
        duplex: 'half',
      } as RequestInit),
    );

    if (error) {
      console.error(`[s3] saveResult | error: ${error.message}`);
      throw error;
    }
  }

  public async saveResultDetails(resultID: string, resultDetails: ResultDetails, size: number) {
    const result = await storage.saveResultDetails(resultID, resultDetails, size);

    resultCache.onCreated(result);

    return result;
  }

  public async getResultsProjects(): Promise<string[]> {
    const { results } = await this.getResults();
    const projects = getUniqueProjectsList(results);

    const reportProjects = await this.getReportsProjects();

    return Array.from(new Set([...projects, ...reportProjects]));
  }

  public async getResultsTags(project?: string): Promise<string[]> {
    const { results } = await this.getResults(project ? { project } : undefined);

    const notMetadataKeys = ['resultID', 'title', 'createdAt', 'size', 'sizeBytes', 'project'];
    const allTags = new Set<string>();

    results.forEach((result) => {
      Object.entries(result).forEach(([key, value]) => {
        if (!notMetadataKeys.includes(key) && value !== undefined && value !== null) {
          allTags.add(`${key}: ${value}`);
        }
      });
    });

    return Array.from(allTags).sort();
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

  public async getConfig() {
    const cached = configCache.config;

    if (cached) {
      console.log(`[service] using cached config`);

      return cached;
    }

    const { result, error } = await storage.readConfigFile();

    if (error) console.error(`[service] getConfig | error: ${error.message}`);

    return { ...defaultConfig, ...(result ?? {}) };
  }

  public async updateConfig(config: Partial<SiteWhiteLabelConfig>) {
    console.log(`[service] updateConfig`, config);
    const { result, error } = await storage.saveConfigFile(config);

    if (error) {
      throw error;
    }

    configCache.onChanged(result);

    return result;
  }
}

export const service = Service.getInstance();

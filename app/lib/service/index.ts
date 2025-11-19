import { PassThrough, Readable } from 'node:stream';

import { withError } from '../withError';
import { bytesToString, getUniqueProjectsList } from '../storage/format';
import { serveReportRoute } from '../constants';
import { DEFAULT_STREAM_CHUNK_SIZE } from '../storage/constants';

import { lifecycle } from '@/app/lib/service/lifecycle';
import { configCache } from '@/app/lib/service/cache/config';
import { reportDb, resultDb } from '@/app/lib/service/db';
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
import { isValidPlaywrightVersion } from '@/app/lib/pw';
import { getTimestamp } from '@/app/lib/time';

const runningService = Symbol.for('playwright.reports.service');
const instance = globalThis as typeof globalThis & { [runningService]?: Service };

class Service {
  public static getInstance() {
    console.log(`[service] get instance`);
    instance[runningService] ??= new Service();

    return instance[runningService];
  }

  private shouldUseServerCache(): boolean {
    return env.USE_SERVER_CACHE && lifecycle.isInitialized();
  }

  public async getReports(input?: ReadReportsInput) {
    console.log(`[service] getReports`);
    const cached = this.shouldUseServerCache() && reportDb.initialized ? reportDb.getAll() : [];

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
    const cached = this.shouldUseServerCache() && reportDb.initialized ? reportDb.getByID(id) : undefined;

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

  private async findLatestPlaywrightVersionFromResults(resultIds: string[]) {
    for (const resultId of resultIds) {
      const { result: results, error } = await withError(this.getResults({ search: resultId }));

      if (error || !results) {
        continue;
      }

      const [latestResult] = results.results;

      if (!latestResult) {
        continue;
      }

      const latestVersion = latestResult?.playwrightVersion;

      if (latestVersion) {
        return latestVersion;
      }
    }
  }

  private async findLatestPlaywrightVersion(resultIds: string[]) {
    const versionFromResults = await this.findLatestPlaywrightVersionFromResults(resultIds);

    if (versionFromResults) {
      return versionFromResults;
    }

    // just in case version not found in results, we can try to get it from latest reports
    const { result: reportsArray, error } = await withError(this.getReports({ pagination: { limit: 10, offset: 0 } }));

    if (error || !reportsArray) {
      return '';
    }

    const reportWithVersion = reportsArray.reports.find((report) => !!report.metadata?.playwrightVersion);

    if (!reportWithVersion) {
      return '';
    }

    return reportWithVersion.metadata.playwrightVersion;
  }

  public async generateReport(
    resultsIds: string[],
    metadata?: ReportMetadata,
  ): Promise<{ reportId: string; reportUrl: string; metadata: ReportMetadata }> {
    const version = isValidPlaywrightVersion(metadata?.playwrightVersion)
      ? metadata?.playwrightVersion
      : await this.findLatestPlaywrightVersion(resultsIds);

    const metadataWithVersion = { ...(metadata ?? {}), playwrightVersion: version ?? '' };

    const reportId = await storage.generateReport(resultsIds, metadataWithVersion);

    const report = await this.getReport(reportId);

    reportDb.onCreated(report);

    const projectPath = metadata?.project ? `${encodeURI(metadata.project)}/` : '';
    const reportUrl = `${serveReportRoute}/${projectPath}${reportId}/index.html`;

    return { reportId, reportUrl, metadata: metadataWithVersion };
  }

  public async deleteReports(reportIDs: string[]) {
    const { error } = await withError(storage.deleteReports(reportIDs));

    if (error) {
      throw error;
    }

    reportDb.onDeleted(reportIDs);
  }

  public async getReportsProjects(): Promise<string[]> {
    const { reports } = await this.getReports();
    const projects = getUniqueProjectsList(reports);

    return projects;
  }

  public async getResults(input?: ReadResultsInput): Promise<ReadResultsOutput> {
    console.log(`[results service] getResults`);
    const cached = this.shouldUseServerCache() && resultDb.initialized ? resultDb.getAll() : [];

    if (!cached.length) {
      return await storage.readResults(input);
    }

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
    if (input?.search?.trim()) {
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

  public async deleteResults(resultIDs: string[]): Promise<void> {
    const { error } = await withError(storage.deleteResults(resultIDs));

    if (error) {
      throw error;
    }

    resultDb.onDeleted(resultIDs);
  }

  public async getPresignedUrl(fileName: string): Promise<string | undefined> {
    console.log(`[service] getPresignedUrl for ${fileName}`);

    if (env.DATA_STORAGE !== 's3') {
      console.log(`[service] fs storage detected, no presigned URL needed`);

      return '';
    }

    console.log(`[service] s3 detected, generating presigned URL`);

    const { result: presignedUrl, error } = await withError((storage as S3).generatePresignedUploadUrl(fileName));

    if (error) {
      console.error(`[service] getPresignedUrl | error: ${error.message}`);

      return '';
    }

    return presignedUrl!;
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

    resultDb.onCreated(result);

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
    const canCalculateFromCache = this.shouldUseServerCache() && reportDb.initialized && resultDb.initialized;

    if (!canCalculateFromCache) {
      return await storage.getServerDataInfo();
    }

    const reports = reportDb.getAll();
    const results = resultDb.getAll();

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
    const cached = this.shouldUseServerCache() && configCache.initialized ? configCache.config : undefined;

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

import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import type { SiteWhiteLabelConfig } from '@playwright-reports/shared';
import { env } from '../../config/env.js';
import { defaultConfig } from '../config.js';
import { serveReportRoute } from '../constants.js';
import { isValidPlaywrightVersion } from '../pw.js';
import { DEFAULT_STREAM_CHUNK_SIZE, TMP_FOLDER } from '../storage/constants.js';
import { bytesToString, getUniqueProjectsList } from '../storage/format.js';
import {
  type ReadReportsInput,
  type ReadResultsInput,
  type ReadResultsOutput,
  type ReportMetadata,
  type ReportPath,
  type Result,
  type ResultDetails,
  type ServerDataInfo,
  storage,
} from '../storage/index.js';
import type { S3 } from '../storage/s3.js';
import { withError } from '../withError.js';
import { configCache } from './cache/config.js';
import { reportDb, resultDb } from './db/index.js';
import { lifecycle } from './lifecycle.js';
import { testManagementService } from './testManagement.js';

class Service {
  private static instance: Service | null = null;

  public static getInstance(): Service {
    Service.instance ??= new Service();
    return Service.instance;
  }

  public async getReports(input?: ReadReportsInput) {
    return reportDb.query(input);
  }

  public async getReport(id: string) {
    const report = reportDb.getByID(id);

    if (!report) {
      throw new Error(`report ${id} not found`);
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

    const { result: reportsArray, error } = await withError(
      this.getReports({ pagination: { limit: 10, offset: 0 } })
    );

    if (error || !reportsArray) {
      return '';
    }

    const reportWithVersion = reportsArray.reports.find(
      (report) => !!report.metadata?.playwrightVersion
    );

    if (!reportWithVersion) {
      return '';
    }

    return reportWithVersion.metadata.playwrightVersion;
  }

  public async generateReport(
    resultsIds: string[],
    metadata?: ReportMetadata
  ): Promise<{
    reportId: string;
    reportUrl: string;
    metadata: ReportMetadata;
  }> {
    const version = isValidPlaywrightVersion(metadata?.playwrightVersion)
      ? metadata?.playwrightVersion
      : await this.findLatestPlaywrightVersion(resultsIds);

    const metadataWithVersion = {
      ...(metadata ?? {}),
      playwrightVersion: version ?? '',
    };

    const { reportId, report } = await storage.generateReport(resultsIds, metadataWithVersion);

    reportDb.onCreated(report);

    const { error: testsErr } = await withError(testManagementService.processReport(report));
    if (testsErr) {
      console.error(
        `[service] generateReport - failed to process report tests: ${testsErr instanceof Error ? testsErr?.message : String(testsErr)}`
      );
    }

    const reportUrl = `${serveReportRoute}/${reportId}/index.html`;

    return { reportId, reportUrl, metadata: metadataWithVersion };
  }

  public async deleteReports(reportIDs: string[]) {
    const entries: ReportPath[] = [];

    for (const id of reportIDs) {
      const report = await this.getReport(id);

      entries.push({ reportID: id, project: report.project });
    }

    const { error } = await withError(storage.deleteReports(entries));

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
    return resultDb.query(input);
  }

  public async deleteResults(resultIDs: string[]): Promise<void> {
    const { error } = await withError(storage.deleteResults(resultIDs));

    if (error) {
      console.error(`[service] deleteResults - storage deletion failed:`, error);
      throw error;
    }

    resultDb.onDeleted(resultIDs);
  }

  public async getPresignedUrl(fileName: string): Promise<string | undefined> {
    if (env.DATA_STORAGE !== 's3') {
      return '';
    }

    const { result: presignedUrl, error } = await withError(
      (storage as S3).generatePresignedUploadUrl(fileName)
    );

    if (error) {
      console.error(`[service] getPresignedUrl | error: ${error.message}`);

      return '';
    }

    if (!presignedUrl) {
      console.error(`[service] getPresignedUrl | presigned URL is null or undefined`);

      return '';
    }

    return presignedUrl;
  }

  public async saveResult(
    filename: string,
    stream: PassThrough,
    options?: {
      presignedUrl?: string;
      contentLength?: string;
      shouldStoreLocalCopy?: boolean;
    }
  ) {
    // Forks the upload to a local temp copy (S3 mode only) so it can be reused without re-downloading.
    const uploadStream = new PassThrough({ highWaterMark: DEFAULT_STREAM_CHUNK_SIZE });

    if (options?.shouldStoreLocalCopy && env.DATA_STORAGE === 's3') {
      const localCopyStream = new PassThrough({ highWaterMark: DEFAULT_STREAM_CHUNK_SIZE });
      stream.pipe(localCopyStream);
      const localCopyPath = path.join(TMP_FOLDER, 'results', filename);
      const writeStream = createWriteStream(localCopyPath);
      localCopyStream.pipe(writeStream);

      writeStream.on('error', (error) => {
        console.error(`[service] local write error: ${error.message}`);
      });
    }

    stream.pipe(uploadStream);

    if (!options?.presignedUrl) {
      return await storage.saveResult(filename, uploadStream);
    }

    const { error } = await withError(
      fetch(options?.presignedUrl, {
        method: 'PUT',
        body: Readable.toWeb(uploadStream, {
          strategy: {
            highWaterMark: DEFAULT_STREAM_CHUNK_SIZE,
          },
        }),
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': options?.contentLength,
        },
        duplex: 'half',
      } as RequestInit)
    );

    if (error) {
      console.error(`[s3] saveResult | error: ${error.message}`);
      throw error;
    }
  }

  public async saveResultDetails(resultID: string, resultDetails: ResultDetails, size: number) {
    const result: Result = {
      resultID,
      createdAt: new Date().toISOString(),
      project: resultDetails?.project ?? '',
      ...resultDetails,
      sizeBytes: size,
      size: bytesToString(size),
    } as Result;

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
    const canCalculateFromCache =
      lifecycle.isInitialized() && reportDb.initialized && resultDb.initialized;

    if (!canCalculateFromCache) {
      return await storage.getServerDataInfo();
    }

    return storage.getServerDataInfo();
  }

  public async getConfig() {
    if (lifecycle.isInitialized() && configCache.initialized) {
      const cached = configCache.config;

      if (cached) {
        return cached;
      }
    }

    const { result, error } = await storage.readConfigFile();

    if (error) console.warn(`[service] getConfig | error: ${error.message}`);

    return { ...defaultConfig, ...(result ?? {}) };
  }

  public async updateConfig(config: Partial<SiteWhiteLabelConfig>) {
    const { result, error } = await storage.saveConfigFile(config);

    if (error) {
      throw error;
    }

    configCache.onChanged(result);

    return result;
  }

}

export const service = Service.getInstance();

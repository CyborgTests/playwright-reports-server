import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { RESERVED_REPORT_FIELDS, type SiteWhiteLabelConfig } from '@playwright-reports/shared';
import { env } from '../../config/env.js';
import { serveReportRoute } from '../constants.js';
import { invalidateFailureClustersCache } from '../failure-clustering/index.js';
import { isValidPlaywrightVersion } from '../pw-cache.js';
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
import type { Report } from '../storage/types.js';
import { withError } from '../withError.js';
import { configCache } from './cache/config.js';
import { reportDb, reportResultsDb, resultDb } from './db/index.js';
import { siteConfigDb } from './db/siteConfig.sqlite.js';
import { lifecycle } from './lifecycle.js';
import { dispatchReportUploaded } from './notifications/dispatcher.js';
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

  public getExpiredReportIds(cutoffISO: string, limit: number): string[] {
    return reportDb.getExpiredIds(cutoffISO, limit);
  }

  public getExpiredResultIds(cutoffISO: string, limit: number): string[] {
    return resultDb.getExpiredIds(cutoffISO, limit);
  }

  public async getReport(id: string) {
    const report = reportDb.getByID(id);

    if (!report) {
      throw new Error(`report ${id} not found`);
    }

    return {
      ...report,
      previousReportId: reportDb.getPreviousReportId(id),
    };
  }

  private async findLatestPlaywrightVersionFromResults(resultIds: string[]) {
    if (resultIds.length === 0) return undefined;

    const { result: rows, error } = await withError(Promise.resolve(resultDb.getByIDs(resultIds)));
    if (error || !rows) return undefined;

    const byId = new Map<string, (typeof rows)[number]>(rows.map((r) => [r.resultID, r]));
    for (const resultId of resultIds) {
      const version = byId.get(resultId)?.playwrightVersion;
      if (version) return version;
    }
    return undefined;
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
    reportResultsDb.linkReportToResults(reportId, resultsIds);

    const { error: testsErr } = await withError(testManagementService.processReport(report));
    if (testsErr) {
      console.error(
        `[service] generateReport - failed to process report tests: ${testsErr instanceof Error ? testsErr?.message : String(testsErr)}`
      );
    }

    this.dispatchNotificationsForReport(report).catch((err) => {
      console.error(
        `[service] notification dispatch crashed for report ${report.reportID}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    });

    // Failure clusters are derived from test_runs across the window — a new
    // report can add tests, change occurrence counts, and form new clusters,
    // so drop the cache rather than wait for the 60s TTL.
    invalidateFailureClustersCache();

    const { error: cleanupErr } = await withError(storage.cleanupGeneratedReport(reportId));
    if (cleanupErr) {
      console.warn(
        `[service] generateReport - failed to clean up local copy for ${reportId}: ${cleanupErr.message}`
      );
    }

    const reportUrl = `${serveReportRoute}/${reportId}/index.html`;

    return { reportId, reportUrl, metadata: metadataWithVersion };
  }

  public async updateReports(
    reportIDs: string[],
    patch: { project?: string; tags?: Record<string, string>; removeTags?: string[] }
  ): Promise<{ updated: number; missing: string[] }> {
    return reportDb.updateMetadata(reportIDs, patch);
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
    invalidateFailureClustersCache();
  }

  public async getReportsProjects(): Promise<string[]> {
    const { reports } = await this.getReports();
    const projects = getUniqueProjectsList(reports);

    return projects;
  }

  public async getReportsTags(project?: string): Promise<string[]> {
    const { reports } = await this.getReports(project ? { project } : undefined);

    const allTags = new Set<string>();

    reports.forEach((report) => {
      Object.entries(report as unknown as Record<string, unknown>).forEach(([key, value]) => {
        if (RESERVED_REPORT_FIELDS.has(key)) return;
        if (value === undefined || value === null) return;
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
          return;
        }
        allTags.add(`${key}: ${value}`);
      });
    });

    return Array.from(allTags).sort();
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
    // Forks the upload to a local temp copy (remote-storage modes only) so it can be reused without
    // re-downloading. Writes go to <filename>.part and are renamed to <filename> only after the
    // upload succeeds, so a partial blob is never visible to generateReport.
    const uploadStream = new PassThrough({ highWaterMark: DEFAULT_STREAM_CHUNK_SIZE });

    let onUploadSuccess: (() => Promise<void>) | undefined;
    let onUploadFailure: (() => Promise<void>) | undefined;

    const usesRemoteStorage = env.DATA_STORAGE === 's3' || env.DATA_STORAGE === 'azure';

    if (options?.shouldStoreLocalCopy && usesRemoteStorage) {
      const localCopyStream = new PassThrough({ highWaterMark: DEFAULT_STREAM_CHUNK_SIZE });
      stream.pipe(localCopyStream);
      const finalPath = path.join(TMP_FOLDER, 'results', filename);
      const partialPath = `${finalPath}.part`;
      const writeStream = createWriteStream(partialPath);
      localCopyStream.pipe(writeStream);

      let writeFailed = false;
      writeStream.on('error', (error) => {
        writeFailed = true;
        console.error(`[service] local copy write error: ${error.message}`);
      });

      const writeSettled = new Promise<void>((resolve) => {
        writeStream.on('finish', () => resolve());
        writeStream.on('close', () => resolve());
      });

      onUploadSuccess = async () => {
        await writeSettled;
        if (writeFailed) {
          await withError(fs.unlink(partialPath));
          return;
        }
        const { error } = await withError(fs.rename(partialPath, finalPath));
        if (error) {
          console.error(`[service] local copy rename error: ${error.message}`);
          await withError(fs.unlink(partialPath));
        }
      };
      onUploadFailure = async () => {
        await writeSettled;
        await withError(fs.unlink(partialPath));
      };
    }

    stream.pipe(uploadStream);

    try {
      if (!options?.presignedUrl) {
        const result = await storage.saveResult(filename, uploadStream);
        await onUploadSuccess?.();
        return result;
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

      await onUploadSuccess?.();
    } catch (err) {
      await onUploadFailure?.();
      throw err;
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

    siteConfigDb.ensureSeeded();
    return siteConfigDb.get();
  }

  public async updateConfig(config: Partial<SiteWhiteLabelConfig>) {
    const result = siteConfigDb.set(config);
    configCache.onChanged(result);
    return result;
  }

  private async dispatchNotificationsForReport(report: Report): Promise<void> {
    try {
      const cfg = await this.getConfig();
      await dispatchReportUploaded(report, cfg.notifications);
    } catch (err) {
      console.error(
        `[service] notification dispatch failed for report ${report.reportID}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}

export const service = Service.getInstance();

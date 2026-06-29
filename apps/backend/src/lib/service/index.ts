import { stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import type { PassThrough } from 'node:stream';
import type { SiteWhiteLabelConfig } from '@playwright-reports/shared';
import { serveReportRoute } from '../constants.js';
import { invalidateFailureClustersCache } from '../failure-clustering/index.js';
import { isValidPlaywrightVersion } from '../pw-cache.js';
import { UUIDSchema } from '../schemas/index.js';
import { DATA_FOLDER } from '../storage/constants.js';
import { bytesToString } from '../storage/format.js';
import {
  type ReadReportsInput,
  type ReadResultsInput,
  type ReadResultsOutput,
  type ReportPath,
  type ReportUploadMetadata,
  type Result,
  type ResultDetails,
  type ServerDataInfo,
  storage,
} from '../storage/index.js';
import { getPresignedUploadUrl, uploadResult } from '../storage/resultUpload.js';
import type { Report } from '../storage/types.js';
import { processWithConcurrency } from '../utils/semaphore.js';
import { withError } from '../withError.js';
import { configCache } from './cache/config.js';
import { reportDb, reportResultsDb, resultDb, siteConfigDb } from './db/index.js';
import { lifecycle } from './lifecycle.js';
import { dispatchReportUploaded } from './notifications/dispatcher.js';
import { testManagementService } from './test-management/index.js';

async function dataDbFileBytes(): Promise<number> {
  let total = 0;
  for (const name of ['metadata.db', 'metadata.db-wal', 'metadata.db-shm']) {
    try {
      total += (await stat(path.join(DATA_FOLDER, name))).size;
    } catch {
      // -wal/-shm may not exist - skip
    }
  }
  return total;
}

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
    metadata?: ReportUploadMetadata
  ): Promise<{
    reportId: string;
    reportUrl: string;
    metadata: ReportUploadMetadata;
  }> {
    const version = isValidPlaywrightVersion(metadata?.playwrightVersion)
      ? metadata?.playwrightVersion
      : await this.findLatestPlaywrightVersion(resultsIds);

    const metadataWithVersion = {
      ...(metadata ?? {}),
      playwrightVersion: version ?? '',
    };

    const { reportId, report } = await storage.generateReport(resultsIds, metadataWithVersion);

    const rollbackStorage = async (reason: string): Promise<void> => {
      console.error(`[service] generateReport - rolling back storage for ${reportId}: ${reason}`);
      await withError(storage.deleteReports([{ reportID: reportId, project: report.project }]));
    };

    const { error: onCreatedErr } = await withError(
      Promise.resolve().then(() => {
        reportDb.onCreated(report);
        reportResultsDb.linkReportToResults(reportId, resultsIds);
      })
    );
    if (onCreatedErr) {
      await rollbackStorage(`reportDb.onCreated failed: ${onCreatedErr.message}`);
      throw onCreatedErr;
    }

    const { error: testsErr } = await withError(testManagementService.processReport(report));
    if (testsErr) {
      console.error(
        `[service] generateReport - failed to process report tests: ${testsErr instanceof Error ? testsErr?.message : String(testsErr)}`
      );
      try {
        reportDb.onDeleted([reportId]);
      } catch (dbErr) {
        console.error(
          `[service] generateReport - DB rollback failed for ${reportId}: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`
        );
      }
      await rollbackStorage(`processReport failed: ${testsErr.message}`);
      throw testsErr;
    }

    this.dispatchNotificationsForReport(report).catch((err) => {
      console.error(
        `[service] notification dispatch crashed for report ${report.reportID}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    });

    // Failure clusters are derived from test_runs across the window - a new
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
    return reportDb.getDistinctProjects();
  }

  public async getReportsTags(project?: string): Promise<string[]> {
    return reportDb.getDistinctTags(project);
  }

  public async getResults(input?: ReadResultsInput): Promise<ReadResultsOutput> {
    return resultDb.query(input);
  }

  public async deleteResults(resultIDs: string[]): Promise<void> {
    const invalid = resultIDs.filter((id) => !UUIDSchema.safeParse(id).success);
    if (invalid.length > 0) {
      throw new Error(`deleteResults: invalid result id(s): ${invalid.join(', ')}`);
    }

    const { error } = await withError(storage.deleteResults(resultIDs));

    if (error) {
      console.error(`[service] deleteResults - storage deletion failed:`, error);
      throw error;
    }

    resultDb.onDeleted(resultIDs);
  }

  public async getPresignedUrl(fileName: string): Promise<string> {
    return getPresignedUploadUrl(fileName);
  }

  public async saveResult(
    filename: string,
    stream: PassThrough,
    options?: {
      presignedUrl?: string;
      contentLength?: string;
      shouldStoreLocalCopy?: boolean;
    }
  ): Promise<void> {
    return uploadResult(filename, stream, options);
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
    const resultProjects = resultDb.getDistinctProjects();
    const reportProjects = reportDb.getDistinctProjects();
    return Array.from(new Set([...resultProjects, ...reportProjects]));
  }

  public async getResultsTags(project?: string): Promise<string[]> {
    return resultDb.getDistinctTags(project);
  }

  public async getServerInfo(): Promise<ServerDataInfo> {
    const reports = reportDb.getStorageInfo();
    const results = resultDb.getStorageInfo();
    const dbBytes = await dataDbFileBytes();
    const dataBytes = reports.totalSizeBytes + results.totalSizeBytes + dbBytes;

    let availableSizeinMB = 'Unlimited';
    try {
      const fsStat = await statfs(DATA_FOLDER);
      availableSizeinMB = bytesToString(fsStat.bsize * fsStat.bavail);
    } catch {
      // statfs unavailable on some mounts - leave "Unlimited"
    }

    return {
      dataFolderSizeinMB: bytesToString(dataBytes),
      numOfResults: results.count,
      resultsFolderSizeinMB: bytesToString(results.totalSizeBytes),
      numOfReports: reports.count,
      reportsFolderSizeinMB: bytesToString(reports.totalSizeBytes),
      availableSizeinMB,
    };
  }

  public async reconcileStorageSizes(): Promise<{ reportsZeroed: number; resultsZeroed: number }> {
    const reportIds = reportDb.listSizedIds();
    const missingReports: string[] = [];
    await processWithConcurrency(reportIds, 10, async (id) => {
      const { result: exists, error } = await withError(storage.reportExists(id));
      if (!error && exists === false) missingReports.push(id);
    });

    const resultIds = resultDb.listSizedIds();
    const missingResults: string[] = [];
    await processWithConcurrency(resultIds, 10, async (id) => {
      const { result: exists, error } = await withError(storage.resultExists(id));
      if (!error && exists === false) missingResults.push(id);
    });

    const reportsZeroed = this.applyStoragePruneGuarded('report', reportIds.length, missingReports);
    const resultsZeroed = this.applyStoragePruneGuarded('result', resultIds.length, missingResults);

    if (reportsZeroed || resultsZeroed) {
      console.log(
        `[storage-reconcile] zeroed size for ${reportsZeroed} report(s) + ${resultsZeroed} result(s) with missing files`
      );
    }
    return { reportsZeroed, resultsZeroed };
  }

  private applyStoragePruneGuarded(
    kind: 'report' | 'result',
    checked: number,
    missing: string[]
  ): number {
    const MASS_MISSING_MIN = 20;
    const MASS_MISSING_RATIO = 0.9;
    if (checked >= MASS_MISSING_MIN && missing.length / checked >= MASS_MISSING_RATIO) {
      console.warn(
        `[storage-reconcile] ${missing.length}/${checked} ${kind}s appear missing (≥${MASS_MISSING_RATIO * 100}%) - assuming storage fault, NOT zeroing. Check storage connectivity/config.`
      );
      return 0;
    }
    if (kind === 'report') reportDb.markStoragePruned(missing);
    else resultDb.markStoragePruned(missing);
    return missing.length;
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

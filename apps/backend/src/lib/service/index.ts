import { stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import type { PassThrough } from 'node:stream';
import {
  type AttachmentCleanupKind,
  CLEANUP_KINDS,
  CLEANUP_RULES,
  type CleanupEstimate,
  type CleanupKind,
  cleanupDays,
  type FailureCategorySource,
  formatBytes,
  isCleanupConfirmed,
  type SiteWhiteLabelConfig,
} from '@playwright-reports/shared';
import { APP_VERSION } from '../../version.js';
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
import type { Report, ReportHistory } from '../storage/types.js';
import { processWithConcurrency } from '../utils/semaphore.js';
import { withError } from '../withError.js';
import { invalidateAnalyticsCache } from './analytics.js';
import { configCache } from './cache/config.js';
import {
  reportDb,
  reportResultsDb,
  resultDb,
  siteConfigDb,
  testDb,
  testQueriesDb,
} from './db/index.js';
import { type CleanupCursor, cursorOf, type ReportStorageRow } from './db/reports.sqlite.js';
import { lifecycle } from './lifecycle.js';
import { dispatchReportUploaded } from './notifications/dispatcher.js';
import { testManagementService } from './test-management/index.js';

export const CLEANUP_BATCH_SIZE = 200;
export const CLEANUP_MAX_PER_RUN = 5000;

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

export function retentionCutoff(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function setFailureCategory(
  testId: string,
  reportId: string,
  category: string,
  source: FailureCategorySource
): number {
  const changed = testDb.updateFailureCategoryByTest(testId, reportId, category, source);
  invalidateFailureClustersCache();
  invalidateAnalyticsCache();
  return changed;
}

export async function processReportOrRollback(report: ReportHistory): Promise<void> {
  const { error } = await withError(testManagementService.processReport(report));
  if (!error) return;

  console.error(
    `[service] processReport failed for ${report.reportID}, rolling back: ${error.message}`
  );
  try {
    reportDb.onDeleted([report.reportID]);
  } catch (dbError) {
    console.error(
      `[service] DB rollback failed for ${report.reportID}: ${dbError instanceof Error ? dbError.message : String(dbError)}`
    );
  }
  const { error: storageError } = await withError(
    storage.deleteReports([
      { reportID: report.reportID, project: report.project, storagePath: report.storagePath },
    ])
  );
  if (storageError) {
    console.error(
      `[service] storage rollback failed for ${report.reportID}, objects may be orphaned: ${storageError.message}`
    );
  }
  invalidateFailureClustersCache();
  invalidateAnalyticsCache();
  throw error;
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
      files: testQueriesDb.getReportFileTree(id),
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
      await withError(
        storage.deleteReports([
          { reportID: reportId, project: report.project, storagePath: report.storagePath },
        ])
      );
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

    await processReportOrRollback(report);

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
    invalidateAnalyticsCache();

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
    const result = reportDb.updateMetadata(reportIDs, patch);
    if (patch.project !== undefined) invalidateAnalyticsCache();
    return result;
  }

  public async deleteReports(reportIDs: string[]) {
    const entries: ReportPath[] = [];

    for (const id of reportIDs) {
      const report = reportDb.getByID(id);
      if (!report) throw new Error(`report ${id} not found`);

      entries.push({ reportID: id, project: report.project, storagePath: report.storagePath });
    }

    const { error } = await withError(storage.deleteReports(entries));

    if (error) {
      throw error;
    }

    reportDb.onDeleted(reportIDs);
    invalidateFailureClustersCache();
    invalidateAnalyticsCache();
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
      version: APP_VERSION,
      dataFolderSizeinMB: bytesToString(dataBytes),
      numOfResults: results.count,
      resultsFolderSizeinMB: bytesToString(results.totalSizeBytes),
      numOfReports: reports.count,
      reportsFolderSizeinMB: bytesToString(reports.totalSizeBytes),
      availableSizeinMB,
    };
  }

  public async getCleanupEstimates(
    windows?: Partial<Record<CleanupKind, number>>
  ): Promise<CleanupEstimate[]> {
    const cron = (await this.getConfig()).cron ?? {};
    const estimates: CleanupEstimate[] = [];

    for (const kind of CLEANUP_KINDS) {
      const days = windows?.[kind] ?? cleanupDays(cron, kind);
      if (days === undefined) continue;
      const cutoff = retentionCutoff(days);

      switch (kind) {
        case 'trace':
        case 'video':
        case 'screenshot':
          estimates.push({ kind, days, ...reportDb.estimateAttachmentCleanup(kind, cutoff) });
          break;
        case 'reportFiles':
          estimates.push({ kind, days, ...reportDb.estimateReportFilesCleanup(cutoff) });
          break;
        case 'reports':
          estimates.push({ kind, days, ...reportDb.estimateReportRecordCleanup(cutoff) });
          break;
        case 'results':
          estimates.push({ kind, days, ...resultDb.estimateResultCleanup(cutoff) });
          break;
      }
    }

    return estimates;
  }

  public async confirmCleanup(
    kind: CleanupKind,
    days: number
  ): Promise<{ confirmed: boolean; error?: string }> {
    const fresh = siteConfigDb.get().cron ?? {};
    const current = cleanupDays(fresh, kind);

    if (current === undefined) {
      return { confirmed: false, error: `${CLEANUP_RULES[kind].label} retention is not enabled.` };
    }
    if (current !== days) {
      return {
        confirmed: false,
        error: `${CLEANUP_RULES[kind].label} retention changed to ${current} days - review the new estimate.`,
      };
    }

    const merged = {
      ...fresh,
      cleanupConfirmations: {
        ...fresh.cleanupConfirmations,
        [kind]: { confirmedAt: new Date().toISOString(), confirmedDays: days },
      },
    };
    configCache.onChanged(siteConfigDb.set({ cron: merged }));
    return { confirmed: true };
  }

  private async *cleanupBatches<T extends CleanupCursor>(
    kind: CleanupKind,
    fetch: (limit: number, after: CleanupCursor | null) => T[]
  ): AsyncGenerator<T[]> {
    let cursor: CleanupCursor | null = null;
    let attempted = 0;

    while (attempted < CLEANUP_MAX_PER_RUN) {
      if (!isCleanupConfirmed((await this.getConfig()).cron ?? {}, kind)) {
        console.log(`[cleanup] ${kind} stopped mid-run: no longer confirmed`);
        return;
      }
      const batch = fetch(CLEANUP_BATCH_SIZE, cursor);
      if (batch.length === 0) return;
      cursor = cursorOf(batch);
      attempted += batch.length;

      yield batch;

      if (batch.length < CLEANUP_BATCH_SIZE) return;
    }
  }

  public async deleteExpiredAttachments(
    kind: AttachmentCleanupKind,
    cutoffISO: string
  ): Promise<void> {
    let failed = 0;
    let deleted = 0;
    let freedTotal = 0;

    const fetch = (limit: number, after: CleanupCursor | null) =>
      reportDb.getAttachmentCleanupCandidates(kind, cutoffISO, limit, after);

    for await (const candidates of this.cleanupBatches(kind, fetch)) {
      const results = await processWithConcurrency(candidates, 10, async (candidate) => {
        const { result: present } = await withError(
          storage.reportExists(candidate.reportID, candidate.storagePath)
        );
        if (!present) return null;
        const { result: removal, error } = await withError(
          storage.deleteReportAttachments(candidate.reportID, candidate.storagePath, [kind])
        );
        if (error || !removal || removal.failed > 0) return null;
        return { reportID: candidate.reportID, freedBytes: removal.freed };
      });

      const done = results.filter((row): row is NonNullable<typeof row> => row !== null);
      failed += candidates.length - done.length;
      reportDb.markAttachmentDeleted(kind, done);
      deleted += done.length;
      freedTotal += done.reduce((total, row) => total + row.freedBytes, 0);
    }

    if (deleted > 0 || failed > 0) {
      console.log(
        `[cleanup] ${kind}: ${deleted} row(s) marked, ${formatBytes(freedTotal)} freed` +
          (failed > 0 ? `, ${failed} failed` : '') +
          ` (cutoff=${cutoffISO})`
      );
      invalidateAnalyticsCache();
    }
  }

  public async deleteExpiredReportFiles(cutoffISO: string): Promise<void> {
    let skipped = 0;
    let removedCount = 0;

    const fetch = (limit: number, after: CleanupCursor | null) =>
      reportDb.getReportFilesCleanupCandidates(cutoffISO, limit, after);

    for await (const candidates of this.cleanupBatches('reportFiles', fetch)) {
      const present = await processWithConcurrency(candidates, 10, async (candidate) => {
        const { result: exists } = await withError(
          storage.reportExists(candidate.reportID, candidate.storagePath ?? null)
        );
        return exists ? candidate : null;
      });
      const deletable = present.filter((row): row is (typeof candidates)[number] => row !== null);
      skipped += candidates.length - deletable.length;
      if (deletable.length === 0) continue;

      const { result: removedIds, error } = await withError(storage.deleteReports(deletable));
      if (error || !removedIds) {
        console.error(
          `[cleanup] report files batch failed after ${removedCount}: ${error?.message}`
        );
        return;
      }
      if (removedIds.length === 0) {
        console.warn('[cleanup] report files: whole batch failed to delete, stopping');
        break;
      }
      reportDb.markStoragePruned(removedIds);
      removedCount += removedIds.length;
    }

    if (removedCount > 0 || skipped > 0) {
      console.log(
        `[cleanup] report files: ${removedCount} report(s)` +
          (skipped > 0 ? `, ${skipped} skipped (files not found)` : '') +
          ` (cutoff=${cutoffISO})`
      );
    }
    if (removedCount > 0) {
      invalidateFailureClustersCache();
      invalidateAnalyticsCache();
    }
  }

  public async reconcileStorageSizes(): Promise<void> {
    const RECONCILE_SCAN_LIMIT = 10_000;
    const candidates = reportDb.listReportStorageRows(RECONCILE_SCAN_LIMIT);
    const missingReports: string[] = [];
    const presentReports = new Set<string>();
    await processWithConcurrency(candidates, 10, async (candidate) => {
      const { result: exists, error } = await withError(
        storage.reportExists(candidate.reportID, candidate.storagePath)
      );
      if (error) return;
      if (exists) presentReports.add(candidate.reportID);
      else missingReports.push(candidate.reportID);
    });

    const resultIds = resultDb.listSizedIds();
    const missingResults: string[] = [];
    await processWithConcurrency(resultIds, 10, async (id) => {
      const { result: exists, error } = await withError(storage.resultExists(id));
      if (!error && exists === false) missingResults.push(id);
    });

    reportDb.clearArtifactsMissing(
      candidates
        .filter(
          (candidate) => candidate.artifactsMissingAt && presentReports.has(candidate.reportID)
        )
        .map((candidate) => candidate.reportID)
    );

    const alreadyMarked = new Set(
      candidates.filter((candidate) => candidate.artifactsMissingAt).map((c) => c.reportID)
    );
    const probed = presentReports.size + missingReports.length;
    const reportsFlagged = this.applyStoragePruneGuarded(
      'report',
      probed,
      missingReports.filter((id) => !alreadyMarked.has(id))
    );
    const resultsZeroed = this.applyStoragePruneGuarded('result', resultIds.length, missingResults);

    if (reportsFlagged || resultsZeroed) {
      console.log(
        `[storage-reconcile] flagged ${reportsFlagged} report(s) as missing files + zeroed ${resultsZeroed} result(s)`
      );
    }

    await this.backfillAttachmentSizes(candidates, presentReports);
  }

  private async backfillAttachmentSizes(
    candidates: ReportStorageRow[],
    present: Set<string>
  ): Promise<void> {
    const MAX_PER_RUN = 5000;
    const pending = candidates
      .filter((candidate) => candidate.attachmentSizes === null && present.has(candidate.reportID))
      .slice(0, MAX_PER_RUN);
    if (pending.length === 0) return;

    let failed = 0;
    const measured = await processWithConcurrency(pending, 10, async (candidate) => {
      const { result: sizes, error } = await withError(
        storage.reportAttachmentSizes(candidate.reportID, candidate.storagePath)
      );
      if (error || !sizes) {
        failed += 1;
        return null;
      }
      return { reportID: candidate.reportID, sizes };
    });

    const recorded = measured.filter((row): row is NonNullable<typeof row> => row !== null);
    reportDb.setAttachmentSizes(recorded);

    console.log(
      `[storage-reconcile] recorded attachment sizes for ${recorded.length} report(s)` +
        (failed ? `, ${failed} unreadable` : '') +
        (pending.length === MAX_PER_RUN ? ' (run cap reached, resuming next run)' : '')
    );
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

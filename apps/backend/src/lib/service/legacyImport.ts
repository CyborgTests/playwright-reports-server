import path from 'node:path';
import { serveReportRoute } from '../constants.js';
import { REPORTS_BUCKET, RESULTS_BUCKET } from '../storage/constants.js';
import { storage } from '../storage/index.js';
import type { ReportHistory, Result } from '../storage/types.js';
import { withError } from '../withError.js';
import { reportDb, resultDb } from './db/index.js';
import { testManagementService } from './test-management/index.js';

const LEGACY_REPORT_SIDECAR = 'report-server-metadata.json';

export interface LegacyImportSummary {
  reports: { imported: number; skipped: number; total: number };
  results: { imported: number; skipped: number; total: number };
  errors: string[];
}

export type LegacyImportPhase = 'idle' | 'running' | 'done' | 'failed';

export interface LegacyImportStatus {
  phase: LegacyImportPhase;
  summary: LegacyImportSummary;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

function emptySummary(): LegacyImportSummary {
  return {
    reports: { imported: 0, skipped: 0, total: 0 },
    results: { imported: 0, skipped: 0, total: 0 },
    errors: [],
  };
}

let importStatus: LegacyImportStatus = {
  phase: 'idle',
  summary: emptySummary(),
  error: null,
  startedAt: null,
  finishedAt: null,
};

export function getLegacyImportStatus(): LegacyImportStatus {
  return importStatus;
}

export function startLegacyImport(): { started: boolean; reason?: string } {
  if (importStatus.phase === 'running') return { started: false, reason: 'already running' };
  const summary = emptySummary();
  importStatus = {
    phase: 'running',
    summary,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  void runImport(summary);
  return { started: true };
}

async function runImport(summary: LegacyImportSummary): Promise<void> {
  try {
    await importLegacyData(summary);
    importStatus = { ...importStatus, phase: 'done', finishedAt: new Date().toISOString() };
  } catch (error) {
    importStatus = {
      ...importStatus,
      phase: 'failed',
      error: error instanceof Error ? error.message : String(error),
      finishedAt: new Date().toISOString(),
    };
  }
}

// The legacy `report-server-metadata.json` is the original server's parsed `ReportInfo`
// (raw Playwright report.json tree) plus server fields. We trust the folder for id/project
// and overlay the sidecar for stats/files/metadata; both forks' parsers are byte-identical
// so `testId`/`fileId` match and history continuity holds.
interface LegacyReportSidecar {
  createdAt?: string;
  startTime?: number;
  project?: string;
  title?: string;
  size?: string;
  sizeBytes?: number;
  [key: string]: unknown;
}

interface LegacyResultSidecar {
  resultID?: string;
  createdAt?: string;
  project?: string;
  title?: string;
  size?: string;
  sizeBytes?: number;
  [key: string]: unknown;
}

// Import legacy reports & results that live in place under the configured storage backend.
// Zero-copy: blobs stay where they are; we record `storagePath` on each report so the serve
// route resolves the original `{project}/{id}/` location. Backend-agnostic (fs/s3/azure) via
// the storage `listKeys`/`readToString` primitives. Idempotent - existing ids are skipped.
export async function importLegacyData(summary: LegacyImportSummary): Promise<void> {
  await importLegacyResults(summary);
  await importLegacyReports(summary);
}

async function importLegacyResults(summary: LegacyImportSummary): Promise<void> {
  const keys = (await storage.listKeys(RESULTS_BUCKET)).filter((key) => key.endsWith('.json'));
  summary.results.total = keys.length;
  for (const key of keys) {
    const resultID = path.basename(key, '.json');
    if (resultDb.getByID(resultID)) {
      summary.results.skipped++;
      continue;
    }
    const raw = await storage.readToString(key);
    if (!raw) {
      summary.errors.push(`result ${resultID}: unreadable sidecar`);
      continue;
    }
    try {
      const sidecar = JSON.parse(raw) as LegacyResultSidecar;
      const record: Result = {
        ...sidecar,
        resultID,
        createdAt: sidecar.createdAt ?? new Date().toISOString(),
        project: sidecar.project ?? '',
        size: sidecar.size ?? '',
        sizeBytes: sidecar.sizeBytes ?? 0,
      } as Result;
      resultDb.onCreated(record);
      summary.results.imported++;
    } catch (parseError) {
      summary.errors.push(`result ${resultID}: ${(parseError as Error).message}`);
    }
  }
}

async function importLegacyReports(summary: LegacyImportSummary): Promise<void> {
  const keys = (await storage.listKeys(REPORTS_BUCKET)).filter((key) =>
    key.endsWith(`/${LEGACY_REPORT_SIDECAR}`)
  );
  summary.reports.total = keys.length;
  for (const key of keys) {
    // key = `data/reports/{project}/{id}/report-server-metadata.json`
    const directoryKey = key.slice(0, -(LEGACY_REPORT_SIDECAR.length + 1));
    const relativeDir = directoryKey.slice(REPORTS_BUCKET.length + 1); // strip `data/reports/`
    const segments = relativeDir.split('/');
    const reportID = segments[segments.length - 1];
    const project = segments.slice(0, -1).join('/');
    // null when already flat (`{id}`); serve then uses the native path.
    const storagePath = relativeDir === reportID ? null : relativeDir;

    if (!reportID || reportDb.getByID(reportID)) {
      summary.reports.skipped++;
      continue;
    }

    const raw = await storage.readToString(key);
    if (!raw) {
      summary.errors.push(`report ${reportID}: unreadable sidecar`);
      continue;
    }

    let report: ReportHistory;
    try {
      const sidecar = JSON.parse(raw) as LegacyReportSidecar;
      report = {
        ...sidecar,
        reportID,
        project: project || sidecar.project || '',
        reportUrl: `${serveReportRoute}/${reportID}/index.html`,
        createdAt:
          sidecar.createdAt ??
          (sidecar.startTime
            ? new Date(sidecar.startTime).toISOString()
            : new Date().toISOString()),
        size: sidecar.size ?? '',
        sizeBytes: sidecar.sizeBytes ?? 0,
        storagePath,
      } as ReportHistory;
    } catch (parseError) {
      summary.errors.push(`report ${reportID}: ${(parseError as Error).message}`);
      continue;
    }

    reportDb.onCreated(report);
    // Backfills test_runs/tests/analytics from the sidecar's files[] tree. Rich failure
    // detail is read on demand via loadReportPayload (now storagePath-aware).
    const { error: processError } = await withError(testManagementService.processReport(report));
    if (processError) {
      summary.errors.push(`report ${reportID} processReport: ${processError.message}`);
    }
    summary.reports.imported++;
  }
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { STORAGE_TYPES } from '@playwright-reports/shared';
import { env } from '../../config/env.js';
import { serveReportRoute } from '../constants.js';
import { REPORTS_FOLDER, RESULTS_FOLDER } from '../storage/constants.js';
import type { ReportHistory, Result } from '../storage/types.js';
import { withError } from '../withError.js';
import { reportDb, resultDb } from './db/index.js';
import { testManagementService } from './test-management/index.js';

const LEGACY_REPORT_SIDECAR = 'report-server-metadata.json';

export interface LegacyImportSummary {
  reports: { imported: number; skipped: number };
  results: { imported: number; skipped: number };
  errors: string[];
}

// The legacy `report-server-metadata.json` is the original server's parsed `ReportInfo`
// (raw Playwright report.json tree) plus server fields. We trust the folder for id/project
// and overlay the sidecar for stats/files/metadata;
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

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

// Import legacy reports & results that live in place under the configured data folders.
// Zero-copy: blobs stay where they are; we record `storagePath` on each report so the serve
// route resolves the original `{project}/{id}/` location.
export async function importLegacyData(): Promise<LegacyImportSummary> {
  const summary: LegacyImportSummary = {
    reports: { imported: 0, skipped: 0 },
    results: { imported: 0, skipped: 0 },
    errors: [],
  };

  if (env.DATA_STORAGE !== STORAGE_TYPES.FILESYSTEM) {
    throw new Error(
      `legacy import currently supports filesystem storage only (DATA_STORAGE=${env.DATA_STORAGE})`
    );
  }

  await importLegacyResults(summary);
  await importLegacyReports(summary);
  return summary;
}

async function importLegacyResults(summary: LegacyImportSummary): Promise<void> {
  const { result: entries, error } = await withError(
    fs.readdir(RESULTS_FOLDER, { withFileTypes: true })
  );
  if (error || !entries) return; // no results folder yet

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const resultID = entry.name.slice(0, -'.json'.length);
    if (resultDb.getByID(resultID)) {
      summary.results.skipped++;
      continue;
    }
    const { result: raw, error: readError } = await withError(
      fs.readFile(path.join(RESULTS_FOLDER, entry.name), 'utf-8')
    );
    if (readError || !raw) {
      summary.errors.push(`result ${resultID}: ${readError?.message ?? 'unreadable sidecar'}`);
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
  const { result: entries, error } = await withError(
    fs.readdir(REPORTS_FOLDER, { withFileTypes: true, recursive: true })
  );
  if (error || !entries) return; // no reports folder yet

  for (const entry of entries) {
    if (!entry.isFile() || entry.name !== LEGACY_REPORT_SIDECAR) continue;

    const dir = entry.parentPath;
    const relativeDir = toPosix(path.relative(REPORTS_FOLDER, dir));
    const segments = relativeDir.split('/');
    const reportID = segments[segments.length - 1];
    const project = segments.slice(0, -1).join('/');
    // null when already flat (`{id}`); serve then uses the native path.
    const storagePath = relativeDir === reportID ? null : relativeDir;

    if (!reportID || reportDb.getByID(reportID)) {
      summary.reports.skipped++;
      continue;
    }

    const { result: raw, error: readError } = await withError(
      fs.readFile(path.join(dir, LEGACY_REPORT_SIDECAR), 'utf-8')
    );
    if (readError || !raw) {
      summary.errors.push(`report ${reportID}: ${readError?.message ?? 'unreadable sidecar'}`);
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
    // backfills test_runs/tests/analytics from the sidecar's files[] tree. Rich failure
    // detail needs the blob (loadReportPayload, local-fs only) and degrades to null here.
    const { error: processError } = await withError(testManagementService.processReport(report));
    if (processError) {
      summary.errors.push(`report ${reportID} processReport: ${processError.message}`);
    }
    summary.reports.imported++;
  }
}

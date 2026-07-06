import type { PassThrough, Readable } from 'node:stream';
import type { ReportInfo, ReportPath, ServerDataInfo, UUID } from '@playwright-reports/shared';
import type { Pagination } from '../pagination.js';

export type { ReportPath, ServerDataInfo };

export interface ByteRange {
  /** First byte offset to serve (defaults to 0). Mutually exclusive with suffixLength. */
  start?: number;
  /** Inclusive end byte offset (defaults to the last byte). */
  end?: number;
  /** Serve the last N bytes; resolved against the file size by the backend. */
  suffixLength?: number;
}

/** Resolve a (possibly partial or suffix) range request against a known file size. */
export function resolveFileRange(
  totalSize: number,
  range?: ByteRange
): { start: number; end: number; contentLength: number } {
  let start = range?.start ?? 0;
  let end = range?.end ?? totalSize - 1;

  if (range?.suffixLength !== undefined) {
    start = totalSize - range.suffixLength;
    end = totalSize - 1;
  }

  start = Math.max(0, start);
  end = Math.min(end, totalSize - 1);

  return { start, end, contentLength: end - start + 1 };
}

/**
 * Parse an HTTP Range header (e.g. "bytes=0-1023", "bytes=512-", "bytes=-256")
 * into a {@link ByteRange}. The backend resolves open-ended and suffix ranges
 * against the file size. Returns undefined for a malformed / non-bytes range.
 */
export function parseRangeHeader(rangeHeader: string): ByteRange | undefined {
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);

  if (!match) return undefined;

  const [, rawStart, rawEnd] = match;

  if (rawStart === '' && rawEnd === '') return undefined;

  if (rawStart === '') {
    const suffixLength = parseInt(rawEnd, 10);
    if (suffixLength <= 0) return undefined;
    return { suffixLength };
  }

  const start = parseInt(rawStart, 10);
  if (rawEnd === '') return { start };

  const end = parseInt(rawEnd, 10);
  if (end < start) return undefined;
  return { start, end };
}

export interface ReadFileResult {
  body: Readable;
  size?: number;
  totalSize?: number;
  contentRange?: { start: number; end: number; total: number };
}

export interface Storage {
  reportExists: (reportId: string) => Promise<boolean>;
  resultExists: (resultId: string) => Promise<boolean>;
  readFile: (
    targetPath: string,
    contentType: string | null,
    range?: ByteRange
  ) => Promise<ReadFileResult | null>;
  deleteResults: (resultIDs: string[]) => Promise<void>;
  deleteReports: (reports: ReportPath[]) => Promise<void>;
  saveResult: (filename: string, stream: PassThrough) => Promise<void>;
  generateReport: (
    resultsIds: string[],
    metadata?: ReportUploadMetadata
  ) => Promise<{ reportId: UUID; reportPath: string; report: ReportHistory }>;
  uploadReportFromZipFile: (
    reportId: string,
    zipFilePath: string,
    metadata?: ReportUploadMetadata,
    onProgress?: (completed: number, total: number) => void
  ) => Promise<{ reportPath: string; report: ReportHistory }>;
  cleanupGeneratedReport: (reportId: string) => Promise<void>;
  uploadBrandingAsset: (relativePath: string) => Promise<void>;
  ensureBrandingAsset: (relativePath: string) => Promise<void>;
  deleteBrandingAsset: (relativePath: string) => Promise<void>;

  // --- Legacy migration ---
  // Generic key-scan/read helpers used by the one-shot legacy importer to scan the
  // legacy reports layout.
  // see migration 0024. Not part of the normal report/result flow.
  //
  // List full bucket-relative keys of all objects under `prefix` (recursive). `prefix` is
  // rooted at DATA_PATH, e.g. `data/reports` or `data/results`. Returns [] if none.
  listKeys: (prefix: string) => Promise<string[]>;
  // Read a small object fully as UTF-8 by its full bucket-relative key. Null on miss/error.
  readToString: (key: string) => Promise<string | null>;
  // Read an object fully as a Buffer by its full bucket-relative key. Null on miss/error.
  // For binary attachments (trace zips, screenshots)
  readToBuffer: (key: string) => Promise<Buffer | null>;
}

export interface ReadResultsInput {
  pagination?: Pagination;
  project?: string;
  testRun?: string;
  tags?: string[];
  search?: string;
  from?: string;
  to?: string;
  usage?: 'used' | 'unused';
}

export interface ReadResultsOutput {
  results: Result[];
  total: number;
}

export interface ReadReportsInput {
  pagination?: Pagination;
  project?: string;
  ids?: string[];
  search?: string;
  tags?: string[];
  from?: string;
  to?: string;
  passRate?: 'passing' | 'failing' | 'below-threshold';
  regressionsOnly?: boolean;
}

export interface ReadReportsOutput {
  reports: ReportHistory[];
  total: number;
}

// For custom user fields
export interface ResultDetails {
  [key: string]: string;
}

export type Result = {
  resultID: UUID;
  title?: string;
  createdAt: string;
  project: string;
  size: string;
  sizeBytes: number;
} & ResultDetails;

export type Report = {
  reportID: string;
  title?: string;
  displayNumber?: number;
  project: string;
  reportUrl: string;
  createdAt: string;
  size: string;
  sizeBytes: number;
  // Relative storage prefix for in-place legacy reports (`{project}/{id}`); null/undefined
  // for native flat reports whose path is the reportID. See migration 0024.
  storagePath?: string | null;
  regressions?: {
    newHere: number;
    resolvedHere: number;
    newTests?: Array<{
      testId: string;
      fileId: string;
      project: string;
      title: string;
      filePath: string;
    }>;
    resolvedTests?: Array<{
      testId: string;
      fileId: string;
      project: string;
      title: string;
      filePath: string;
    }>;
  };
};

export type ReportHistory = Report & ReportInfo;

export type ReportUploadMetadata = Partial<{
  title: string;
  project: string;
  playwrightVersion?: string;
  displayNumber?: number;
}> &
  Record<string, string | number | undefined>;

import { PassThrough, Readable } from 'node:stream';

import { type Pagination } from './pagination';

import { type SiteWhiteLabelConfig, type UUID } from '@/app/types';
import { type ReportInfo, type ReportTest } from '@/app/lib/parser/types';

export interface ReportFile {
  relativePath: string;
  storagePath: string;
}

export interface FileRange {
  /** First byte offset to serve (defaults to 0) */
  start?: number;
  /** Inclusive end byte offset (defaults to the last byte) */
  end?: number;
  /** Serve the last N bytes; resolved against the file size by the backend */
  suffixLength?: number;
}

/**
 * Parse an HTTP Range header (e.g. "bytes=0-1023", "bytes=512-", "bytes=-256")
 * into a {@link FileRange}. The backend resolves open-ended and suffix ranges
 * against the file size. Returns null for a malformed / non-bytes range.
 */
export function parseRangeHeader(rangeHeader: string): FileRange | null {
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);

  if (!match) return null;

  const [, rawStart, rawEnd] = match;

  if (rawStart === '' && rawEnd === '') return null;

  if (rawStart === '') {
    return { suffixLength: parseInt(rawEnd, 10) };
  }

  return {
    start: parseInt(rawStart, 10),
    end: rawEnd === '' ? undefined : parseInt(rawEnd, 10),
  };
}

/** Resolve a (possibly partial or suffix) range request against a known file size. */
export function resolveFileRange(
  totalSize: number,
  range?: FileRange,
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

export interface FileStreamResult {
  /** Node.js Readable stream for the requested byte range */
  stream: Readable;
  /** Total size of the file in bytes */
  totalSize: number;
  /** Actual start byte served (may differ when clamped) */
  start: number;
  /** Actual end byte served, inclusive */
  end: number;
  /** Number of bytes in the stream (end - start + 1) */
  contentLength: number;
}

export interface Storage {
  getServerDataInfo: () => Promise<ServerDataInfo>;
  readFile: (targetPath: string, contentType: string | null) => Promise<string | Buffer>;
  /**
   * Stream a byte range of a report asset. When `range` is omitted, stream the whole file.
   * For an unsatisfiable range (e.g. `start` past EOF) the returned `stream` is empty and
   * `contentLength` is `<= 0`, so the caller can respond 416 instead of crashing.
   */
  readFileStream: (targetPath: string, range?: FileRange) => Promise<FileStreamResult>;
  readResults: (input?: ReadResultsInput) => Promise<ReadResultsOutput>;
  readReports: (input?: ReadReportsInput) => Promise<ReadReportsOutput>;
  deleteResults: (resultIDs: string[]) => Promise<void>;
  deleteReports: (reportIDs: string[]) => Promise<void>;
  saveResult: (filename: string, stream: PassThrough) => Promise<void>;
  saveResultDetails: (resultID: string, resultDetails: ResultDetails, size: number) => Promise<Result>;
  generateReport: (resultsIds: string[], metadata?: ReportMetadata) => Promise<UUID>;
  listReportFiles: (reportId: string, project: string) => Promise<ReportFile[]>;
  readConfigFile: () => Promise<{ result?: SiteWhiteLabelConfig; error: Error | null }>;
  saveConfigFile: (
    config: Partial<SiteWhiteLabelConfig>,
  ) => Promise<{ result: SiteWhiteLabelConfig; error: Error | null }>;
}

export type SortOrder = 'asc' | 'desc';

export interface ReadResultsInput {
  pagination?: Pagination;
  project?: string;
  testRun?: string;
  tags?: string[];
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  order?: SortOrder;
  sortBy?: 'createdAt' | 'title' | 'project' | 'tags' | 'size';
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
  dateFrom?: string;
  dateTo?: string;
  order?: SortOrder;
  sortBy?: 'createdAt' | 'title' | 'project' | 'passRate' | 'size';
}

export interface ReadReportsOutput {
  reports: ReportHistory[];
  total: number;
}

export interface ReadReportsHistory {
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
  project: string;
  reportUrl: string;
  createdAt: Date;
  size: string;
  sizeBytes: number;
};

export type ReportHistory = Report & ReportInfo;

export const isReportHistory = (report: Report | ReportHistory | undefined): report is ReportHistory =>
  !!report && typeof report === 'object' && 'stats' in report;

export type TestHistory = Report & ReportTest;

export type ReportMetadata = Partial<{ title: string; project: string; playwrightVersion?: string }> &
  Record<string, string>;

export interface ServerDataInfo {
  dataFolderSizeinMB: string;
  numOfResults: number;
  resultsFolderSizeinMB: string;
  numOfReports: number;
  reportsFolderSizeinMB: string;
}

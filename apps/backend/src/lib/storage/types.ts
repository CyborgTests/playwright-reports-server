import type { PassThrough, Readable } from 'node:stream';
import type {
  ReportInfo,
  ReportTest,
  SiteWhiteLabelConfig,
  UUID,
} from '@playwright-reports/shared';
import type { Pagination } from './pagination.js';

export interface Storage {
  getServerDataInfo: () => Promise<ServerDataInfo>;
  readFile: (targetPath: string, contentType: string | null) => Promise<string | Buffer>;
  deleteResults: (resultIDs: string[]) => Promise<void>;
  deleteReports: (reports: ReportPath[]) => Promise<void>;
  saveResult: (filename: string, stream: PassThrough) => Promise<void>;
  generateReport: (
    resultsIds: string[],
    metadata?: ReportMetadata
  ) => Promise<{ reportId: UUID; reportPath: string; report: ReportHistory }>;
  uploadReportFromStream: (
    reportId: string,
    zipStream: Readable,
    metadata?: ReportMetadata
  ) => Promise<{ reportPath: string; report: ReportHistory }>;
  readConfigFile: () => Promise<{
    result?: SiteWhiteLabelConfig;
    error: Error | null;
  }>;
  saveConfigFile: (
    config: Partial<SiteWhiteLabelConfig>
  ) => Promise<{ result: SiteWhiteLabelConfig; error: Error | null }>;
}

export interface ReportPath {
  reportID: string;
  project?: string;
}

export interface ReadResultsInput {
  pagination?: Pagination;
  project?: string;
  testRun?: string;
  tags?: string[];
  search?: string;
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
  displayNumber?: number;
  project: string;
  reportUrl: string;
  createdAt: Date;
  size: string;
  sizeBytes: number;
};

export type ReportHistory = Report & ReportInfo;

export const isReportHistory = (
  report: Report | ReportHistory | undefined
): report is ReportHistory => !!report && typeof report === 'object' && 'stats' in report;

export type TestHistory = Report & ReportTest;

export type ReportMetadata = Partial<{
  title: string;
  project: string;
  playwrightVersion?: string;
  displayNumber?: number;
}> &
  Record<string, string | number | undefined>;

export interface ServerDataInfo {
  dataFolderSizeinMB: string;
  numOfResults: number;
  resultsFolderSizeinMB: string;
  numOfReports: number;
  reportsFolderSizeinMB: string;
  availableSizeinMB: string;
}

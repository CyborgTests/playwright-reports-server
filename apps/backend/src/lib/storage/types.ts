import type { PassThrough, Readable } from 'node:stream';
import type { ReportInfo, ReportPath, ServerDataInfo, UUID } from '@playwright-reports/shared';
import type { Pagination } from './pagination.js';

export type { ReportPath, ServerDataInfo };

export interface ReadFileResult {
  body: Readable;
  size?: number;
}

export interface Storage {
  getServerDataInfo: () => Promise<ServerDataInfo>;
  readFile: (targetPath: string, contentType: string | null) => Promise<ReadFileResult | null>;
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
    metadata?: ReportUploadMetadata
  ) => Promise<{ reportPath: string; report: ReportHistory }>;
  cleanupGeneratedReport: (reportId: string) => Promise<void>;
  uploadBrandingAsset: (relativePath: string) => Promise<void>;
  ensureBrandingAsset: (relativePath: string) => Promise<void>;
  deleteBrandingAsset: (relativePath: string) => Promise<void>;
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

export const isReportHistory = (
  report: Report | ReportHistory | undefined
): report is ReportHistory => !!report && typeof report === 'object' && 'stats' in report;

export type ReportUploadMetadata = Partial<{
  title: string;
  project: string;
  playwrightVersion?: string;
  displayNumber?: number;
}> &
  Record<string, string | number | undefined>;

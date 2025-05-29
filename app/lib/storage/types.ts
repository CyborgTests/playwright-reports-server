import { type Pagination } from './pagination';

import { type UUID } from '@/app/types';
import { type ReportInfo, type ReportTest } from '@/app/lib/parser/types';

export interface Storage {
  getServerDataInfo: () => Promise<ServerDataInfo>;
  readFile: (targetPath: string, contentType: string | null) => Promise<string | Buffer>;
  readResults: (input?: ReadResultsInput) => Promise<ReadResultsOutput>;
  readReports: (input?: ReadReportsInput) => Promise<ReadReportsOutput>;
  deleteResults: (resultIDs: string[]) => Promise<void>;
  deleteReports: (reportIDs: string[]) => Promise<void>;
  saveResult: (file: Blob, size: number, resultDetails: ResultDetails) => Promise<Result>;
  generateReport: (resultsIds: string[], metadata?: ReportMetadata) => Promise<UUID>;
  moveReport: (oldPath: string, newPath: string) => Promise<void>;
}

export interface ReadResultsInput {
  pagination?: Pagination;
  project?: string;
  testRun?: string;
}

export interface ReadResultsOutput {
  results: Result[];
  total: number;
}

export interface ReadReportsInput {
  pagination?: Pagination;
  project?: string;
  ids?: string[];
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

export type ReportMetadata = Partial<{ title: string; project: string }> & Record<string, string>;

export interface ServerDataInfo {
  dataFolderSizeinMB: string;
  numOfResults: number;
  resultsFolderSizeinMB: string;
  numOfReports: number;
  reportsFolderSizeinMB: string;
}

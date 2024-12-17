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
  saveResult: (stream: ReadableStream<Uint8Array>, size: number, resultDetails: ResultDetails) => Promise<Result>;
  generateReport: (resultsIds: string[], project?: string) => Promise<UUID>;
  moveReport: (oldPath: string, newPath: string) => Promise<void>;
}

export interface ReadResultsInput {
  pagination?: Pagination;
  project?: string;
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
  reports: Report[];
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
  createdAt: string;
  project: string;
  size: string;
} & ResultDetails;

export type Report = {
  reportID: string;
  project: string;
  reportUrl: string;
  createdAt: Date;
  size: string;
};

export type ReportHistory = Report & ReportInfo;

export const isReportHistory = (report: Report | ReportHistory | undefined): report is ReportHistory =>
  !!report && typeof report === 'object' && 'stats' in report;

export type TestHistory = Report & ReportTest;

export interface ServerDataInfo {
  dataFolderSizeinMB: string;
  numOfResults: number;
  resultsFolderSizeinMB: string;
  numOfReports: number;
  reportsFolderSizeinMB: string;
}

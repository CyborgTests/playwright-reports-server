import { type Pagination } from './pagination';

import { type UUID } from '@/app/types';
import { type ReportInfo, type ReportTest } from '@/app/lib/parser/types';

export interface Storage {
  getServerDataInfo: () => Promise<ServerDataInfo>;
  readFile: (targetPath: string, contentType: string | null) => Promise<string | Buffer>;
  readResults: (input: ReadResultsInput) => Promise<ReadResultsOutput>;
  readReports: (input?: ReadReportsInput) => Promise<ReadReportsOutput>;
  deleteResults: (resultIDs: string[]) => Promise<void>;
  deleteReports: (reportIDs: string[]) => Promise<void>;
  saveResult: (
    buffer: Buffer,
    resultDetails: ResultDetails,
  ) => Promise<{
    resultID: UUID;
    createdAt: string;
    size: string;
  }>;
  generateReport: (resultsIds: string[], project?: string) => Promise<UUID>;
  getReportsProjects: () => Promise<string[]>;
  getResultsProjects: () => Promise<string[]>;
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

export type TestHistory = Report & ReportTest;

export interface ServerDataInfo {
  dataFolderSizeinMB: string;
  numOfResults: number;
  resultsFolderSizeinMB: string;
  numOfReports: number;
  reportsFolderSizeinMB: string;
}

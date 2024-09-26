import { type UUID } from '@/app/types';
import { type ReportInfo, type ReportTest } from '@/app/lib/parser/types';

export interface Storage {
  getServerDataInfo: () => Promise<ServerDataInfo>;
  getFolderSizeInMb: (dir: string) => Promise<string>;
  readFile: (targetPath: string, contentType: string | null) => Promise<string | Buffer>;
  readResults: () => Promise<Result[]>;
  readReports: () => Promise<Report[]>;
  deleteResults: (resultIDs: string[]) => Promise<void>;
  deleteReports: (reportIDs: string[]) => Promise<void>;
  saveResult: (
    buffer: Buffer,
    resultDetails: ResultDetails,
  ) => Promise<{
    resultID: UUID;
    createdAt: string;
  }>;
  generateReport: (resultsIds: string[]) => Promise<UUID>;
}

// For custom user fields
export interface ResultDetails {
  [key: string]: string;
}

export type Result = {
  resultID: UUID;
  createdAt: string;
} & ResultDetails;

export type Report = { reportID: string; reportUrl: string; createdAt: Date };

export type ReportHistory = Report & ReportInfo;

export type TestHistory = Report & ReportTest;

export interface ServerDataInfo {
  dataFolderSizeinMB: string;
  numOfResults: number;
  resultsFolderSizeinMB: string;
  numOfReports: number;
  reportsFolderSizeinMB: string;
}

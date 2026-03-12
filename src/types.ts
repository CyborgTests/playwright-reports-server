export interface Result {
  id: string;
  resultID?: string;
  project: string;
  testRunName?: string;
  reporter: string;
  size: number;
  sizeBytes?: number;
  createdAt: string;
  metadata?: string;
}

export interface ReportStats {
  total: number;
  expected: number;
  unexpected: number;
  flaky: number;
  skipped: number;
  ok?: boolean;
}

export interface Report {
  id: string;
  reportID?: string;
  project: string;
  size: number;
  createdAt: string;
  reportUrl: string;
  resultIds?: string[];
  title?: string;
  stats?: ReportStats;
  metadata?: Record<string, unknown>;
  files?: unknown[];
  projectNames?: string[];
}

export interface ServerInfo {
  dataFolderSizeinMB: string;
  numOfReports: number;
  reportsFolderSizeinMB: string;
}

export interface CronConfig {
  resultExpireDays?: number;
  resultExpireCronSchedule?: string;
  reportExpireDays?: number;
  reportExpireCronSchedule?: string;
}

export interface AppConfig {
  title: string;
  headerLinks: Record<string, string>;
  logoPath?: string;
  faviconPath?: string;
  reporterPaths?: string[];
  authRequired?: boolean;
  serverCache?: boolean;
  dataStorage?: string;
  s3Endpoint?: string;
  s3Bucket?: string;
  cron?: CronConfig;
}

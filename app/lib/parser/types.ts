export interface ReportInfo {
  metadata: ReportMetadata;
  startTime: number;
  duration: number;
  files: ReportFile[];
  projectNames: string[];
  stats: ReportStats;
}

interface ReportMetadata {
  actualWorkers: number;
  playwrightVersion?: string;
}

export interface ReportStats {
  total: number;
  expected: number;
  unexpected: number;
  flaky: number;
  skipped: number;
  ok: boolean;
}

export enum ReportTestOutcome {
  Expected = 'expected',
  Unexpected = 'unexpected',
  Flaky = 'flaky',
  Skipped = 'skipped',
}

export interface ReportFile {
  fileId: string;
  fileName: string;
  tests: ReportTest[];
  stats: ReportStats;
}

export interface ReportTest {
  testId: string;
  title: string;
  projectName: string;
  location: ReportTestLocation;
  duration: number;
  annotations: string[];
  tags: string[];
  outcome: ReportTestOutcome;
  path: string[];
  ok: boolean;
  results: ReportTestResult[];
  createdAt?: Date;
}

interface ReportTestLocation {
  file: string;
  line: number;
  column: number;
}

interface ReportTestAttachment {
  name: string;
  contentType: string;
  path: string;
}

interface ReportTestResult {
  attachments: ReportTestAttachment[];
}

export interface ReportTestFilters {
  outcomes?: ReportTestOutcome[];
  name?: string;
}

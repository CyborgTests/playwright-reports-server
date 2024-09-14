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
}

interface ReportStats {
  total: number;
  expected: number;
  unexpected: number;
  flaky: number;
  skipped: number;
  ok: boolean;
}

enum ReportTestOutcome {
  Expected = 'expected',
  Unexpected = 'unexpected',
  Flaky = 'flaky',
  Skipped = 'skipped',
}

interface ReportFile {
  fileId: string;
  fileName: string;
  tests: ReportTest[];
  stats: ReportStats;
}

interface ReportTest {
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

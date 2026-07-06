import type { ReporterOptions } from './types';

export const DEFAULT_OPTIONS: Omit<ReporterOptions, 'url' | 'reportPath'> = {
  enabled: true,
  resultDetails: {},
  triggerReportGeneration: true,
  requestTimeout: 60000,
  blobUploadTimeout: 10 * 60000,
  skipQuarantinedTests: false,
  quarantineFilePath: './quarantine.json',
  logProgress: false,
};

export type PublicReporterOptions = {
  enabled?: boolean;
  url: string;
  reportPath: string;
  token?: string;
  requestTimeout?: number;
  resultDetails?: Record<string, string>;
  triggerReportGeneration?: boolean;
  skipQuarantinedTests?: boolean;
  quarantineFilePath?: string;
  blobUploadTimeout?: number;
  logProgress?: boolean;
};

/**
 * Used for proper internal typings after merging with default options
 */
export type ReporterOptions = {
  enabled: boolean;
  url: string;
  reportPath: string;
  token?: string;
  requestTimeout?: number;
  resultDetails: Record<string, string>;
  triggerReportGeneration: boolean;
  skipQuarantinedTests: boolean;
  quarantineFilePath: string;
  blobUploadTimeout?: number;
  logProgress?: boolean;
};

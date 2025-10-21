export type GenerateReportResponse = {
  reportId: string;
  reportUrl: string;
  metadata?: {
    title?: string;
    project?: string;
    playwrightVersion?: string;
  };
};

export type GenerateReportResponse = {
  reportId: string;
  reportUrl: string | null;
  metadata?: {
    title?: string;
    project?: string;
    playwrightVersion?: string;
  };
};

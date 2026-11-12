export type UploadResultResponse = {
  message: string;
  status: number;
  data: {
    resultID: string;
    createdAt: string;
    project?: string;
    reporter?: string;
    appVersion?: string;
    size?: string;
    testRun?: string;
    generatedReport?: {
      reportId: string;
      reportUrl: string;
      metadata?: Record<string, unknown>;
    };
  };
};

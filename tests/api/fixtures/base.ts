import { test as base, type APIResponse } from '@playwright/test';
import { ResultController } from '../controllers/ResultController';
import type { UploadResultResponse } from '../controllers/ResultTypes';
import { ReportController } from '../controllers/ReportController';
import { GenerateReportResponse } from '../controllers/ReportTypes';

export const test = base.extend<{
  uploadedResult: { resp: APIResponse; json: UploadResultResponse };
  generatedReport: { resp: APIResponse; json: GenerateReportResponse };
}>({
  uploadedResult: async ({ request }, use) => {
    const resController = new ResultController(request);
    const uploadedRes = await resController.upload({
      filePath: './tests/testdata/blob.zip',
      project: 'Smoke',
      tag: 'api-smoke',
    });

    await use(uploadedRes);
  },
  generatedReport: async ({ request, uploadedResult }, use) => {
    const project = uploadedResult.json.data?.project!;
    const resultID = uploadedResult.json.data?.resultID!;

    const reportController = new ReportController(request);
    const generatedRep = await reportController.generateReport(project, [resultID]);

    await use(generatedRep);
  },
});

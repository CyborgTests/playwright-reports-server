import type { APIResponse } from '@playwright/test';
import { test as base } from '@playwright-reports/reporter';
import { API } from '../controllers';
import type { GenerateReportResponse } from '../types/report';
import type { UploadResultResponse } from '../types/result';

export const test = base.extend<{
  uploadedResult: { response: APIResponse; body: UploadResultResponse };
  generatedReport: { response: APIResponse; body: GenerateReportResponse };
  api: API;
}>({
  api: async ({ request }, use) => {
    await use(new API(request));
  },
  uploadedResult: async ({ api }, use) => {
    const uploadedResult = await api.result.upload('./tests/testdata/correct_blob.zip', {
      project: 'Smoke',
      tag: 'api-smoke',
    });

    await use({ response: uploadedResult.response, body: uploadedResult.body });
  },
  generatedReport: async ({ api, uploadedResult }, use) => {
    const generatedReport = await api.report.generate({
      project: 'Smoke',
      resultsIds: [uploadedResult.body.data?.resultID!],
      title: 'Smoke Test',
    });

    await use(generatedReport);
  },
});

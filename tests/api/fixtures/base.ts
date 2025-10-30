import { test as base, type APIResponse } from '@playwright/test';
import type { UploadResultResponse } from '../types/result';
import { GenerateReportResponse } from '../types/report';
import { API } from '../controllers';

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

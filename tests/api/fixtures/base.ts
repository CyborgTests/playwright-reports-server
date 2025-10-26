import { test as base, type APIResponse } from '@playwright/test';
import type { UploadResultResponse } from '../types/result';
import { GenerateReportResponse } from '../types/report';
import { API } from '../controllers';

export const test = base.extend<{
  uploadedResult: { response: APIResponse; json: UploadResultResponse };
  generatedReport: { response: APIResponse; json: GenerateReportResponse };
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

    await use(uploadedResult);
  },
  generatedReport: async ({ api, uploadedResult }, use) => {
    const generatedReport = await api.report.generate({
      project: uploadedResult.json.data?.project!,
      resultsIds: [uploadedResult.json.data?.resultID!],
      title: 'Smoke Test',
    });

    await use(generatedReport);
  },
});

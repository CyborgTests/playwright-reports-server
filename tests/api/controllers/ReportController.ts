import { APIResponse } from '@playwright/test';
import { BaseController } from './BaseController';
import type { GenerateReportResponse } from './ReportTypes';

export class ReportController extends BaseController {
  async generateReport(
    project: string,
    resultsIds: string[],
  ): Promise<{ resp: APIResponse; json: GenerateReportResponse }> {
    const resp = await this.request.post('/api/report/generate', {
      data: { project, resultsIds },
    });

    const json = (await resp.json()) as GenerateReportResponse;
    return { resp, json };
  }
}

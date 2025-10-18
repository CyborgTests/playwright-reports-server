import { APIResponse } from '@playwright/test';
import { BaseController } from './BaseController';
import type { GenerateReportResponse } from './ReportTypes';
import { ListParams } from './ListTypes';

export class ReportController extends BaseController {
  async generateReport(
    project: string,
    resultsIds: string[],
    title: string,
  ): Promise<{ resp: APIResponse; json: GenerateReportResponse }> {
    const resp = await this.request.post('/api/report/generate', {
      data: { project, resultsIds, title },
      ...(title ? { title } : {}),
    });

    const json = (await resp.json()) as GenerateReportResponse;
    return { resp, json };
  }
  async list(params: ListParams = {}) {
    const response = await this.request.get('/api/report/list', { params });
    const json = await response.json();
    return { response, json };
  }
}

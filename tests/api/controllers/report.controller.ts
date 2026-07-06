import { JsonRequest } from '../req/json.request';
import type { ListParams } from '../types/list';
import type { GenerateReportResponse } from '../types/report';
import { BaseController } from './base.controller';

export class ReportController extends BaseController {
  // TODO: Add rest of params for generate request
  async generate(data: { project: string; resultsIds: string[]; title: string }) {
    return new JsonRequest(this.request).send<GenerateReportResponse>('/api/report/generate', {
      method: 'POST',
      data,
    });
  }

  async list(params: ListParams = {}) {
    const response = await this.request.get('/api/report/list', { params });
    return { response, json: await response.json() };
  }
}

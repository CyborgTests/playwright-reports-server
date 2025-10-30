import { BaseController } from './base.controller';
import type { GenerateReportResponse } from '../types/report';
import { ListParams } from '../types/list';
import { JsonRequest } from '../req/JsonRequest';

export class ReportController extends BaseController {
  // TODO: Add rest of params for generate request
  async generate(data: { project: string; resultsIds: string[]; title: string }) {
    return new JsonRequest(this.request).send<GenerateReportResponse>('/api/report/generate', { method: 'POST', data });
  }

  async list(params: ListParams = {}) {
    const response = await this.request.get('/api/report/list', { params });
    return { response, json: await response.json() };
  }
}

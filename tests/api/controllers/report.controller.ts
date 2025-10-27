import { BaseController } from './base.controller';
import type { GenerateReportResponse } from '../types/report';
import { ListParams } from '../types/list';

export class ReportController extends BaseController {
  // TODO: Add rest of params for generate request
  async generate(data: { project: string; resultsIds: string[]; title: string }) {
    const response = await this.request.post('/api/report/generate', { data });

    return { response, json: (await response.json()) as GenerateReportResponse };
  }

  async list(params: ListParams = {}) {
    const response = await this.request.get('/api/report/list', { params });
    return { response, json: await response.json() };
  }
}

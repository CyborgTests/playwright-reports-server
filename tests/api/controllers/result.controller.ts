import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { JsonRequest } from '../req/json.request';
import type { ListParams } from '../types/list';
import type { UploadResultResponse } from '../types/result';
import { BaseController } from './base.controller';

export class ResultController extends BaseController {
  async upload(
    filePath: string,
    options: {
      project?: string;
      tag?: string;
      testRun?: string;
      shardCurrent?: number;
      shardTotal?: number;
      triggerReportGeneration?: boolean;
    }
  ) {
    const absPath = path.resolve(process.cwd(), filePath);
    const zipBuffer = await readFile(absPath);

    const multipartData: Record<string, any> = {};

    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined && value !== null && key !== 'file') {
        multipartData[key] = String(value);
      }
    }

    const response = await new JsonRequest(this.request).send<UploadResultResponse>(
      '/api/result/upload',
      {
        method: 'PUT',
        multipart: {
          ...multipartData,
          file: {
            name: path.basename(absPath),
            mimeType: 'application/zip',
            buffer: zipBuffer,
          },
        },
      }
    );
    return response;
  }

  async list(params: ListParams = {}) {
    const response = await this.request.get('/api/result/list', { params });
    return { response, json: await response.json() };
  }
}

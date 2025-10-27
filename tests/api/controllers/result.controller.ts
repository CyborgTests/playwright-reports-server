import { BaseController } from './base.controller';
import { UploadResultResponse } from '../types/result';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { ListParams } from '../types/list';

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
    },
  ) {
    const absPath = path.resolve(process.cwd(), filePath);
    const zipBuffer = await readFile(absPath);

    const response = await this.request.put('/api/result/upload', {
      multipart: {
        file: {
          name: path.basename(absPath),
          mimeType: 'application/zip',
          buffer: zipBuffer,
        },
        ...options,
      },
    });

    return { response, json: (await response.json()) as UploadResultResponse };
  }

  async list(params: ListParams = {}) {
    const response = await this.request.get('/api/result/list', { params });
    return { response, json: await response.json() };
  }
}

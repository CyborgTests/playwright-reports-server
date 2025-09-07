import { BaseController } from '../BaseController';
import { UploadResultResponse } from './ResultTypes';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { APIResponse } from '@playwright/test';

export class ResultController extends BaseController {
  async upload(
    filePath: string,
    project?: string,
    tag?: string,
  ): Promise<{ resp: APIResponse; json: UploadResultResponse }> {
    const absPath = path.resolve(process.cwd(), filePath);
    const zipBuffer = await readFile(absPath);

    const resp = await this.request.put('/api/result/upload', {
      multipart: {
        file: { name: path.basename(absPath), mimeType: 'application/zip', buffer: zipBuffer },
        ...(project ? { project } : {}),
        ...(tag ? { tag } : {}),
      },
    });

    const json = (await resp.json()) as UploadResultResponse;
    return { resp, json };
  }
}

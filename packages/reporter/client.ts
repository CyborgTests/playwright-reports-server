import type { UUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import fsp from 'node:fs/promises';
import { Readable } from 'node:stream';
import { makeBoundary, multipartStream } from './stream.js';

export type ReportServerClientOptions = {
  url: string;
  token?: string;
  requestTimeout?: number;
  blobUploadTimeout?: number;
};

export type ReportGenerationOptions = {
  resultId: UUID;
  details: Record<string, string>;
  playwrightVersion: string;
};

export type UploadBlobResult = {
  resultID: UUID;
  createdAt: string;
  size: string;
  sizeBytes: number;
  generatedReport?: {
    reportId: string;
    reportUrl: string;
    metadata: {
      title: string;
      project: string;
    };
  };
  username?: string;
};

type StreamingRequestInit = RequestInit & { duplex: 'half' };

export class ReportServerClient {
  private readonly options: ReportServerClientOptions;

  constructor(options: ReportServerClientOptions) {
    this.options = options;
  }

  private get baseUrl(): string {
    return this.options.url.endsWith('/') ? this.options.url.slice(0, -1) : this.options.url;
  }

  async uploadBlob(
    blobPath: string,
    { fileName = 'blob.zip', fields = {}, logProgress = false }
  ): Promise<UploadBlobResult> {
    let stat: Stats;
    try {
      stat = await fsp.stat(blobPath);
    } catch (err) {
      console.error('[ReportServerClient] failed to stat blob:', err);
      throw new Error(
        '[ReportServerClient] Blob file not found or cannot be loaded. Results cannot be uploaded'
      );
    }

    const zipSize = stat.size;
    const boundary = makeBoundary();
    const iterable = multipartStream({
      boundary,
      fields,
      filePath: blobPath,
      fileName,
      fileType: 'application/zip',
      totalBytes: zipSize,
      logProgress,
    });
    const body = Readable.toWeb(Readable.from(iterable));

    const uploadUrl = `${this.baseUrl}/api/result/upload?fileContentLength=${zipSize}`;

    const headers: Record<string, string> = {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    };
    if (this.options.token) {
      headers.Authorization = this.options.token;
    }

    const totalTimeout =
      this.options.blobUploadTimeout ?? this.options.requestTimeout ?? 10 * 60_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), totalTimeout);

    try {
      const resp = await fetch(uploadUrl, {
        method: 'PUT',
        headers,
        body: body as unknown as BodyInit,
        signal: controller.signal,
        duplex: 'half',
      } as StreamingRequestInit);
      clearTimeout(timeoutId);

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`[ReportServerClient] Upload failed ${resp.status}: ${text.slice(0, 500)}`);
      }

      const json = (await resp.json()) as { data: UploadBlobResult };
      return json.data;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  async uploadReportZip(
    zipPath: string,
    metadata: Record<string, unknown> = {},
    { logProgress = false }: { logProgress?: boolean } = {}
  ): Promise<{ reportId: string; reportUrl: string; metadata: Record<string, unknown> }> {
    let stat: Stats;
    try {
      stat = await fsp.stat(zipPath);
    } catch (err) {
      console.error('[ReportServerClient] failed to stat report zip:', err);
      throw new Error('[ReportServerClient] Report zip not found or cannot be loaded.');
    }

    const zipSize = stat.size;
    const boundary = makeBoundary();
    const iterable = multipartStream({
      boundary,
      fields: { metadata: JSON.stringify(metadata) },
      filePath: zipPath,
      fileName: 'report.zip',
      fileType: 'application/zip',
      totalBytes: zipSize,
      logProgress,
    });
    const body = Readable.toWeb(Readable.from(iterable));

    const uploadUrl = `${this.baseUrl}/api/report/upload`;

    const headers: Record<string, string> = {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    };
    if (this.options.token) {
      headers.Authorization = this.options.token;
    }

    const totalTimeout =
      this.options.blobUploadTimeout ?? this.options.requestTimeout ?? 10 * 60_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), totalTimeout);

    try {
      const resp = await fetch(uploadUrl, {
        method: 'POST',
        headers,
        body: body as unknown as BodyInit,
        signal: controller.signal,
        duplex: 'half',
      } as StreamingRequestInit);
      clearTimeout(timeoutId);

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`[ReportServerClient] Upload failed ${resp.status}: ${text.slice(0, 500)}`);
      }

      return (await resp.json()) as {
        reportId: string;
        reportUrl: string;
        metadata: Record<string, unknown>;
      };
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  async getQuarantinedTests(project?: string): Promise<Array<{ id: string; reason: string }>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.options.token) {
      headers.Authorization = this.options.token;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.requestTimeout ?? 30_000);

    const params = new URLSearchParams();
    if (project) params.set('project', project);
    params.set('status', 'quarantined');

    try {
      const resp = await fetch(`${this.baseUrl}/api/tests?${params}`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(
          `[ReportServerClient] Failed to get list of quarantined tests ${resp.status}: ${text.slice(0, 500)}`
        );
      }

      const tests = (await resp.json()) as {
        data: Array<{ testId: string; quarantineReason: string }>;
      };

      return tests.data.map((test) => ({
        id: test.testId,
        reason: test.quarantineReason,
      }));
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }
}

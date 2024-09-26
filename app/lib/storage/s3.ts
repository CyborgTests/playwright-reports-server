import { randomUUID, type UUID } from 'crypto';
import fs from 'fs/promises';
import path from 'node:path';

import { type BucketItem, Client } from 'minio';

import { bytesToString } from './format';
import { REPORTS_FOLDER, TMP_FOLDER, REPORTS_BUCKET, RESULTS_BUCKET } from './constants';

import { serveReportRoute } from '@/app/lib/constants';
import { generatePlaywrightReport } from '@/app/lib/pw';
import { withError } from '@/app/lib/withError';
import { type Result, type Report, type ResultDetails, type ServerDataInfo } from '@/app/lib/storage/types';
import { env } from '@/app/config/env';

const createClient = () => {
  const endPoint = env.S3_ENDPOINT;
  const accessKey = env.S3_ACCESS_KEY;
  const secretKey = env.S3_SECRET_KEY;
  const port = env.S3_PORT;
  const region = env.S3_REGION;

  if (!endPoint) {
    throw new Error('S3_ENDPOINT is required');
  }

  if (!accessKey) {
    throw new Error('S3_ACCESS_KEY is required');
  }

  if (!secretKey) {
    throw new Error('S3_SECRET_KEY is required');
  }

  console.log('[s3] creating client');

  const client = new Client({
    endPoint,
    accessKey,
    secretKey,
    region,
    port,
    useSSL: true,
  });

  return client;
};

export class S3 {
  private static instance: S3;
  private client: Client;
  private bucket: string;
  private batchSize: number;

  private constructor() {
    this.client = createClient();
    this.bucket = env.S3_BUCKET;
    this.batchSize = env.S3_BATCH_SIZE;
  }

  public static getInstance() {
    if (!S3.instance) {
      S3.instance = new S3();
    }

    return S3.instance;
  }

  private ensureBucketExist = async () => {
    const { result: exist, error } = await withError(this.client.bucketExists(this.bucket));

    if (exist && !error) {
      return;
    }

    if (error) {
      console.error(error);
    }

    const { error: bucketError } = await withError(this.client.makeBucket(this.bucket, env.S3_REGION));

    if (bucketError) {
      console.error(bucketError);
    }
  };

  private async write(dir: string, files: { name: string; content: string | Buffer }[]) {
    await this.ensureBucketExist();
    for (const file of files) {
      console.log(`[s3] writing ${file.name}`);
      const path = `${dir}/${file.name}`;

      await this.client.putObject(this.bucket, path, file.content);
    }
  }

  private async read(targetPath: string, contentType?: string | null) {
    await this.ensureBucketExist();
    console.log(`[s3] read ${targetPath}`);
    const { result: stream, error } = await withError(
      this.client.getObject(this.bucket, `${REPORTS_BUCKET}/${targetPath}`),
    );

    if (error ?? !stream) {
      return { result: null, error };
    }

    const readStream = new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];

      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      stream.on('end', () => {
        const fullContent = Buffer.concat(chunks);

        resolve(fullContent);
      });

      stream.on('error', (error) => {
        console.error(`[s3] failed to read stream: ${error.message}`);
        reject(error);
      });
    });

    const { result, error: readError } = await withError(readStream);

    return {
      result: contentType === 'text/html' ? result?.toString('utf-8') : result,
      error: error ?? readError ?? null,
    };
  }

  async clear(...path: string[]) {
    console.log(`[s3] clearing ${path}`);
    await this.client.removeObjects(this.bucket, path);
  }

  async getFolderSize(folderPath: string): Promise<{ size: number; resultCount: number; indexCount: number }> {
    let resultCount = 0;
    let indexCount = 0;
    let totalSize = 0;
    const stream = this.client.listObjects(this.bucket, folderPath, true);

    return new Promise((resolve, reject) => {
      stream.on('data', (obj) => {
        if (obj.name?.endsWith('.zip')) {
          resultCount += 1;
        }

        if (obj.name?.endsWith('index.html') && !obj.name.includes('trace')) {
          indexCount += 1;
        }

        totalSize += obj.size;
      });

      stream.on('error', (err) => {
        reject(err);
      });

      stream.on('end', () => {
        resolve({ size: totalSize, resultCount, indexCount });
      });
    });
  }

  async getServerDataInfo(): Promise<ServerDataInfo> {
    await this.ensureBucketExist();
    console.log('[s3] getting server data');

    const [results, reports] = await Promise.all([
      this.getFolderSize(RESULTS_BUCKET),
      this.getFolderSize(REPORTS_BUCKET),
    ]);

    const dataSize = results.size + reports.size;

    return {
      dataFolderSizeinMB: bytesToString(dataSize),
      numOfResults: results.resultCount,
      resultsFolderSizeinMB: bytesToString(results.size),
      numOfReports: reports.indexCount,
      reportsFolderSizeinMB: bytesToString(reports.size),
    };
  }

  async readFile(targetPath: string, contentType: string | null): Promise<string | Buffer> {
    console.log(`[s3] reading ${targetPath} | ${contentType}`);
    const { result, error } = await this.read(targetPath, contentType);

    if (error) {
      console.error(`[s3] failed to read file: ${error.message}`);
      throw new Error(`[s3] failed to read file: ${error.message}`);
    }

    return result!;
  }

  private async processBatch<T, R>(items: T[], batchSize: number, asyncAction: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);

      const batchResults = await Promise.all(batch.map(asyncAction.bind(this)));

      results.push(...batchResults);
    }

    return results;
  }

  async readResults(): Promise<Result[]> {
    console.log('[s3] reading results');
    const listResultsStream = this.client.listObjectsV2(this.bucket, RESULTS_BUCKET, true);

    const files: BucketItem[] = [];

    const findJsonFiles = new Promise<BucketItem[]>((resolve, reject) => {
      listResultsStream.on('data', async (file) => {
        if (!file?.name) {
          return;
        }

        if (!file.name.endsWith('.json')) {
          return;
        }

        files.push(file);
      });

      listResultsStream.on('error', (err) => {
        reject(err);
      });

      listResultsStream.on('end', () => {
        resolve(files);
      });
    });

    const { result: jsonFiles } = await withError(findJsonFiles);

    console.log(`[s3] found ${jsonFiles?.length} json files`);

    if (!jsonFiles) {
      return [];
    }

    const results = await this.processBatch<BucketItem, Result>(jsonFiles, this.batchSize, async (file) => {
      console.log(`[s3.batch] reading result: ${JSON.stringify(file)}`);
      const dataStream = await this.client.getObject(this.bucket, file.name!);

      let jsonString = '';

      for await (const chunk of dataStream) {
        jsonString += chunk.toString();
      }

      const parsed = JSON.parse(jsonString);

      return parsed;
    });

    return results;
  }

  async readReports(): Promise<Report[]> {
    console.log(`[s3] reading reports from minio`);
    const reportsStream = this.client.listObjectsV2(this.bucket, REPORTS_BUCKET, true);

    const reports: Report[] = [];

    return new Promise((resolve, reject) => {
      reportsStream.on('data', (file) => {
        if (!file?.name) {
          return;
        }
        if (!file.name.endsWith('index.html') || file.name.includes('trace')) {
          return;
        }

        console.log(`[s3] reading report: ${JSON.stringify(file)}`);

        const id = path.basename(path.dirname(file.name));

        reports.push({
          reportID: id,
          createdAt: file.lastModified,
          reportUrl: `${serveReportRoute}/${id}/index.html`,
        });
      });

      reportsStream.on('error', (err) => {
        reject(err);
      });

      reportsStream.on('end', () => {
        resolve(reports);
      });
    });
  }

  async deleteResults(resultIDs: string[]): Promise<void> {
    const objects = resultIDs.flatMap((id) => [`${RESULTS_BUCKET}/${id}.json`, `${RESULTS_BUCKET}/${id}.zip`]);

    await withError(this.clear(...objects));
  }

  private async getReportObjects(reportId: string): Promise<string[]> {
    const reportStream = this.client.listObjectsV2(this.bucket, `${REPORTS_BUCKET}/${reportId}`, true);

    const files: string[] = [];

    return new Promise((resolve, reject) => {
      reportStream.on('data', (file) => {
        if (!file?.name) {
          return;
        }

        files.push(file.name);
      });

      reportStream.on('error', (err) => {
        reject(err);
      });

      reportStream.on('end', () => {
        resolve(files);
      });
    });
  }

  async deleteReports(reportIDs: string[]): Promise<void> {
    for (const id of reportIDs) {
      const objects = await this.getReportObjects(id);

      await withError(this.clear(...objects));
    }
  }

  async saveResult(buffer: Buffer, resultDetails: ResultDetails): Promise<{ resultID: UUID; createdAt: string }> {
    const resultID = randomUUID();

    const metaData = {
      resultID,
      createdAt: new Date().toISOString(),
      ...resultDetails,
    };

    await this.write(RESULTS_BUCKET, [
      {
        name: `${resultID}.json`,
        content: JSON.stringify(metaData),
      },
      {
        name: `${resultID}.zip`,
        content: buffer,
      },
    ]);

    return metaData;
  }

  private uploadReport = async (reportId: string, reportPath: string) => {
    console.log(`[s3] upload report: ${reportPath}`);

    const files = await fs.readdir(reportPath, { recursive: true, withFileTypes: true });

    await this.processBatch(files, this.batchSize, async (file) => {
      if (!file.isFile()) {
        return;
      }

      console.log(`[s3] uploading file: ${JSON.stringify(file)}`);

      const nestedPath = file.path.split(reportId).pop();
      const s3Path = `/${REPORTS_BUCKET}/${reportId}/${nestedPath}/${file.name}`;

      console.log(`[s3] uploading to ${s3Path}`);

      const { error } = await withError(this.client.fPutObject(this.bucket, s3Path, path.join(file.path, file.name)));

      if (error) {
        console.error(`[s3] failed to upload report: ${error.message}`);
        throw new Error(`[s3] failed to upload report: ${error.message}`);
      }
    });
  };

  private clearTempFolders = async () => {
    console.log(`[s3] clear temp folders`);
    await withError(fs.rm(TMP_FOLDER, { recursive: true, force: true }));
    await withError(fs.rm(REPORTS_FOLDER, { recursive: true, force: true }));
  };

  async generateReport(resultsIds: string[]): Promise<UUID> {
    console.log(`[s3] generate report from results: ${JSON.stringify(resultsIds)}`);
    await this.clearTempFolders();

    console.log(`[s3] create temp folders`);
    await fs.mkdir(REPORTS_FOLDER, { recursive: true });
    await fs.mkdir(TMP_FOLDER, { recursive: true });

    const resultsStream = this.client.listObjects(this.bucket, RESULTS_BUCKET, true);

    console.log(`[s3] start processing...`);
    for await (const result of resultsStream) {
      const fileName = path.basename(result.name);

      console.log(`[s3] checking file ${fileName}`);
      const id = fileName.replace(path.extname(fileName), '');

      if (resultsIds.includes(id)) {
        console.log(`[s3] file id is in target results, downloading...`);
        const localFilePath = path.join(TMP_FOLDER, fileName);

        const { error } = await withError(this.client.fGetObject(this.bucket, result.name, localFilePath));

        if (error) {
          throw new Error(`failed to download ${result.name}: ${error.message}`);
        }

        console.log(`[s3] Downloaded: ${result.name} to ${localFilePath}`);
      }
    }

    const { reportPath, reportId } = await generatePlaywrightReport();

    console.log(`[s3] report generated: ${reportId} | ${reportPath}`);

    await this.uploadReport(reportId, reportPath);
    await this.clearTempFolders();

    return reportId;
  }
}

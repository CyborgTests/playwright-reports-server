import { randomUUID, type UUID } from 'crypto';
import fs from 'fs/promises';
import path from 'node:path';

import { type BucketItem, Client } from 'minio';

import { processBatch } from './batch';
import { ReadReportsInput, ReadReportsOutput, ReadResultsInput, ReadResultsOutput, Storage } from './types';
import { bytesToString, getUniqueProjectsList } from './format';
import { REPORTS_FOLDER, TMP_FOLDER, REPORTS_BUCKET, RESULTS_BUCKET, REPORTS_PATH } from './constants';
import { handlePagination } from './pagination';

import { serveReportRoute } from '@/app/lib/constants';
import { generatePlaywrightReport } from '@/app/lib/pw';
import { withError } from '@/app/lib/withError';
import { type Result, type Report, type ResultDetails, type ServerDataInfo } from '@/app/lib/storage/types';
import { env } from '@/app/config/env';
import { getFileReportID } from './file';

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

export class S3 implements Storage {
  private static instance: S3;
  private readonly client: Client;
  private readonly bucket: string;
  private readonly batchSize: number;

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

  private async ensureBucketExist() {
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
  }

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

        if (obj.name?.endsWith('index.html') && !obj.name.includes('/trace/index.html')) {
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
      console.error(`[s3] failed to read file ${targetPath}: ${error.message}`);
      throw new Error(`[s3] failed to read file: ${error.message}`);
    }

    return result!;
  }

  async readResults(input?: ReadResultsInput): Promise<ReadResultsOutput> {
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
      return {
        results: [],
        total: 0,
      };
    }

    const getTimestamp = (date?: Date) => date?.getTime() ?? 0;

    jsonFiles.sort((a, b) => getTimestamp(b.lastModified) - getTimestamp(a.lastModified));

    // check if we can apply pagination early
    const noFilters = !input?.project && !input?.project;

    const resultFiles = noFilters ? handlePagination(jsonFiles, input?.pagination) : jsonFiles;

    const results = await processBatch<BucketItem, Result>(this, resultFiles, this.batchSize, async (file) => {
      console.log(`[s3.batch] reading result: ${JSON.stringify(file)}`);
      const dataStream = await this.client.getObject(this.bucket, file.name!);

      let jsonString = '';

      for await (const chunk of dataStream) {
        jsonString += chunk.toString();
      }

      const parsed = JSON.parse(jsonString);

      return parsed;
    });

    const byProject = results.filter((file) => (input?.project ? file.project === input.project : file));

    const currentFiles = noFilters ? results : handlePagination(byProject, input?.pagination);

    return {
      results: currentFiles,
      total: noFilters ? jsonFiles.length : byProject.length,
    };
  }

  async readReports(input?: ReadReportsInput): Promise<ReadReportsOutput> {
    console.log(`[s3] reading reports from minio`);
    const reportsStream = this.client.listObjectsV2(this.bucket, REPORTS_BUCKET, true);

    const reports: Report[] = [];
    const reportSizes = new Map<string, number>();

    return new Promise((resolve, reject) => {
      reportsStream.on('data', (file) => {
        if (!file?.name) {
          return;
        }

        const reportID = getFileReportID(file.name);

        const newSize = (reportSizes.get(reportID) ?? 0) + file.size;

        reportSizes.set(reportID, newSize);

        if (!file.name.endsWith('index.html') || file.name.includes('trace')) {
          return;
        }

        console.log(`[s3] reading report: ${JSON.stringify(file)}`);

        const dir = path.dirname(file.name);
        const id = path.basename(dir);
        const parentDir = path.basename(path.dirname(dir));

        const projectName = parentDir === REPORTS_PATH ? '' : parentDir;

        const noFilters = !input?.project && !input?.ids;

        const shouldFilterByProject = input?.project && projectName === input.project;

        const shouldFilterByID = input?.ids && input.ids.includes(id);

        const report = {
          reportID: id,
          project: projectName,
          createdAt: file.lastModified,
          reportUrl: `${serveReportRoute}/${projectName ? encodeURIComponent(projectName) : ''}/${id}/index.html`,
          size: '',
        };

        if (noFilters || shouldFilterByProject || shouldFilterByID) {
          reports.push(report);
        }
      });

      reportsStream.on('error', (err) => {
        reject(err);
      });

      reportsStream.on('end', () => {
        const getTimestamp = (date?: Date) => date?.getTime() ?? 0;

        reports.sort((a, b) => getTimestamp(b.createdAt) - getTimestamp(a.createdAt));

        const currentReports = handlePagination<Report>(reports, input?.pagination);

        resolve({
          reports: currentReports.map((report) => ({
            ...report,
            size: bytesToString(reportSizes.get(report.reportID) ?? 0),
          })),
          total: reports.length,
        });
      });
    });
  }

  async deleteResults(resultIDs: string[]): Promise<void> {
    const objects = resultIDs.flatMap((id) => [`${RESULTS_BUCKET}/${id}.json`, `${RESULTS_BUCKET}/${id}.zip`]);

    await withError(this.clear(...objects));
  }

  private async getReportObjects(reportsIDs: string[]): Promise<string[]> {
    const reportStream = this.client.listObjectsV2(this.bucket, REPORTS_BUCKET, true);

    const files: string[] = [];

    return new Promise((resolve, reject) => {
      reportStream.on('data', (file) => {
        if (!file?.name) {
          return;
        }

        const reportID = path.basename(path.dirname(file.name));

        if (reportsIDs.includes(reportID)) {
          files.push(file.name);
        }
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
    const objects = await this.getReportObjects(reportIDs);

    await withError(this.clear(...objects));
  }

  async saveResult(buffer: Buffer, resultDetails: ResultDetails) {
    const resultID = randomUUID();
    const size = bytesToString(buffer.length);

    const metaData = {
      resultID,
      size,
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

  private async uploadReport(reportId: string, reportPath: string) {
    console.log(`[s3] upload report: ${reportPath}`);

    const files = await fs.readdir(reportPath, { recursive: true, withFileTypes: true });

    await processBatch(this, files, this.batchSize, async (file) => {
      if (!file.isFile()) {
        return;
      }

      console.log(`[s3] uploading file: ${JSON.stringify(file)}`);

      const projectName = file.path.split(REPORTS_PATH).pop()?.split(reportId).shift();

      console.log(`[s3] project name: ${projectName}`);
      const nestedPath = file.path.split(reportId).pop();
      const s3Path = `/${REPORTS_BUCKET}${projectName ?? '/'}${reportId}/${nestedPath}/${file.name}`;

      console.log(`[s3] uploading to ${s3Path}`);

      const { error } = await withError(this.client.fPutObject(this.bucket, s3Path, path.join(file.path, file.name)));

      if (error) {
        console.error(`[s3] failed to upload report: ${error.message}`);
        throw new Error(`[s3] failed to upload report: ${error.message}`);
      }
    });
  }

  private async clearTempFolders(id?: string) {
    const withReportPathMaybe = id ? ` for report ${id}` : '';
    console.log(`[s3] clear temp folders${withReportPathMaybe}`);

    await withError(fs.rm(path.join(TMP_FOLDER, id ?? ''), { recursive: true, force: true }));
    await withError(fs.rm(REPORTS_FOLDER, { recursive: true, force: true }));
  }

  async generateReport(resultsIds: string[], project?: string): Promise<UUID> {
    console.log(`[s3] generate report from results: ${JSON.stringify(resultsIds)}`);
    console.log(`[s3] create temp folders`);
    await fs.mkdir(REPORTS_FOLDER, { recursive: true });
    const { error: mkdirReportsError } = await withError(fs.mkdir(REPORTS_FOLDER, { recursive: true }));

    if (mkdirReportsError) {
      console.error(`[s3] failed to create reports folder: ${mkdirReportsError.message}`);
    }

    const reportId = randomUUID();
    const tempFolder = path.join(TMP_FOLDER, reportId);

    const { error: mkdirTempError } = await withError(fs.mkdir(tempFolder, { recursive: true }));

    if (mkdirTempError) {
      console.error(`[s3] failed to create temporary folder: ${mkdirTempError.message}`);
    }

    const resultsStream = this.client.listObjects(this.bucket, RESULTS_BUCKET, true);

    console.log(`[s3] start processing...`);
    for await (const result of resultsStream) {
      const fileName = path.basename(result.name);

      console.log(`[s3] checking file ${fileName}`);
      const id = fileName.replace(path.extname(fileName), '');

      if (resultsIds.includes(id)) {
        console.log(`[s3] file id is in target results, downloading...`);
        const localFilePath = path.join(tempFolder, fileName);

        const { error } = await withError(this.client.fGetObject(this.bucket, result.name, localFilePath));

        if (error) {
          throw new Error(`failed to download ${result.name}: ${error.message}`);
        }

        console.log(`[s3] Downloaded: ${result.name} to ${localFilePath}`);
      }
    }

    const { reportPath } = await generatePlaywrightReport(reportId, project);

    console.log(`[s3] report generated: ${reportId} | ${reportPath}`);

    await this.uploadReport(reportId, reportPath);
    await this.clearTempFolders(reportId);

    return reportId;
  }

  async getReportsProjects(): Promise<string[]> {
    console.log(`[s3] get reports projects`);

    const { reports } = await this.readReports();

    return getUniqueProjectsList(reports);
  }

  async getResultsProjects(): Promise<string[]> {
    console.log(`[s3] get results projects`);

    const { results } = await this.readResults();

    return getUniqueProjectsList(results);
  }

  async moveReport(oldPath: string, newPath: string): Promise<void> {
    console.log(`[s3] move report: ${oldPath} to ${newPath}`);

    const reportPath = path.join(REPORTS_BUCKET, oldPath);

    const objectStream = this.client.listObjectsV2(this.bucket, reportPath, true);

    for await (const obj of objectStream) {
      if (!obj.name) {
        return;
      }
      const newObjectName = obj.name.replace(oldPath, newPath);

      await this.client.copyObject(this.bucket, newObjectName, `${REPORTS_BUCKET}/${obj.name}`);

      await this.client.removeObject(this.bucket, obj.name);
    }

    console.log(`Folder renamed from ${oldPath} to ${newPath}`);
  }
}

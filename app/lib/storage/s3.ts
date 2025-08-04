import { randomUUID, type UUID } from 'crypto';
import fs from 'fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import { type BucketItem, Client } from 'minio';

import { processBatch } from './batch';
import {
  isReportHistory,
  ReadReportsInput,
  ReadReportsOutput,
  ReadResultsInput,
  ReadResultsOutput,
  ReportHistory,
  ReportMetadata,
  Storage,
} from './types';
import { bytesToString } from './format';
import {
  REPORTS_FOLDER,
  TMP_FOLDER,
  REPORTS_BUCKET,
  RESULTS_BUCKET,
  REPORTS_PATH,
  REPORT_METADATA_FILE,
  APP_CONFIG_S3,
  DATA_PATH,
  DATA_FOLDER,
} from './constants';
import { handlePagination } from './pagination';
import { getFileReportID } from './file';
import { transformBlobToReadable } from './stream';

import { parse } from '@/app/lib/parser';
import { serveReportRoute } from '@/app/lib/constants';
import { generatePlaywrightReport } from '@/app/lib/pw';
import { withError } from '@/app/lib/withError';
import { type Result, type Report, type ResultDetails, type ServerDataInfo } from '@/app/lib/storage/types';
import { env } from '@/app/config/env';
import { SiteWhiteLabelConfig } from '@/app/types';
import { defaultConfig, isConfigValid } from '@/app/lib/config';

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

  private async write(dir: string, files: { name: string; content: Readable | Buffer | string; size?: number }[]) {
    await this.ensureBucketExist();
    for (const file of files) {
      const filePath = path.join(dir, file.name);

      console.log(`[s3] writing ${filePath}`);

      const content = typeof file.content === 'string' ? Buffer.from(file.content) : file.content;

      const contentSize = file.size ?? (Buffer.isBuffer(content) ? content.length : undefined);

      await this.client.putObject(this.bucket, path.normalize(filePath), content, contentSize);
    }
  }

  private async read(targetPath: string, contentType?: string | null) {
    await this.ensureBucketExist();
    console.log(`[s3] read ${targetPath}`);

    const remotePath = targetPath.includes(REPORTS_BUCKET) ? targetPath : `${REPORTS_BUCKET}/${targetPath}`;

    console.log(`[s3] reading from remote path: ${remotePath}`);

    const { result: stream, error } = await withError(this.client.getObject(this.bucket, remotePath));

    if (error ?? !stream) {
      return { result: null, error };
    }

    const readStream = new Promise<Buffer>((resolve, reject) => {
      const chunks: Uint8Array[] = [];

      stream.on('data', (chunk: Uint8Array) => {
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

        totalSize += obj?.size ?? 0;
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
    await this.ensureBucketExist();

    console.log('[s3] reading results');
    const listResultsStream = this.client.listObjectsV2(this.bucket, RESULTS_BUCKET, true);

    const files: BucketItem[] = [];
    const resultSizes = new Map<string, number>();

    const findJsonFiles = new Promise<BucketItem[]>((resolve, reject) => {
      listResultsStream.on('data', async (file) => {
        if (!file?.name) {
          return;
        }

        if (file.name.endsWith('.zip')) {
          const resultID = path.basename(file.name, '.zip');

          resultSizes.set(resultID, file.size);
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

    console.log(`[s3] found ${(jsonFiles ?? [])?.length} json files`);

    if (!jsonFiles) {
      return {
        results: [],
        total: 0,
      };
    }

    const getTimestamp = (date?: Date | string) => {
      if (!date) return 0;
      if (typeof date === 'string') return new Date(date).getTime();

      return date.getTime();
    };

    jsonFiles.sort((a, b) => getTimestamp(b.lastModified) - getTimestamp(a.lastModified));

    // check if we can apply pagination early
    const noFilters = !input?.project && !input?.pagination;

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

    let filteredResults = results.filter((file) => (input?.project ? file.project === input.project : file));

    // Filter by tags if provided
    if (input?.tags && input.tags.length > 0) {
      const notMetadataKeys = ['resultID', 'title', 'createdAt', 'size', 'sizeBytes', 'project'];

      filteredResults = filteredResults.filter((result) => {
        const resultTags = Object.entries(result)
          .filter(([key]) => !notMetadataKeys.includes(key))
          .map(([key, value]) => `${key}: ${value}`);

        return input.tags!.some((selectedTag) => resultTags.includes(selectedTag));
      });
    }

    // Filter by search if provided
    if (input?.search && input.search.trim()) {
      const searchTerm = input.search.toLowerCase().trim();

      filteredResults = filteredResults.filter((result) => {
        // Search in title, resultID, project, and all metadata fields
        const searchableFields = [
          result.title,
          result.resultID,
          result.project,
          ...Object.entries(result)
            .filter(([key]) => !['resultID', 'title', 'createdAt', 'size', 'sizeBytes', 'project'].includes(key))
            .map(([key, value]) => `${key}: ${value}`),
        ].filter(Boolean);

        return searchableFields.some((field) => field?.toLowerCase().includes(searchTerm));
      });
    }

    const currentFiles = noFilters ? results : handlePagination(filteredResults, input?.pagination);

    return {
      results: currentFiles.map((result) => {
        const sizeBytes = resultSizes.get(result.resultID) ?? 0;

        return {
          ...result,
          sizeBytes,
          size: result.size ?? bytesToString(sizeBytes),
        };
      }) as Result[],
      total: noFilters ? jsonFiles.length : filteredResults.length,
    };
  }

  async readReports(input?: ReadReportsInput): Promise<ReadReportsOutput> {
    await this.ensureBucketExist();

    console.log(`[s3] reading reports from external storage`);
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

        const dir = path.dirname(file.name);
        const id = path.basename(dir);
        const parentDir = path.basename(path.dirname(dir));

        const projectName = parentDir === REPORTS_PATH ? '' : parentDir;

        const noFilters = !input?.project && !input?.ids;

        const shouldFilterByProject = input?.project && projectName === input.project;

        const shouldFilterByID = input?.ids?.includes(id);

        const report = {
          reportID: id,
          project: projectName,
          createdAt: file.lastModified,
          reportUrl: `${serveReportRoute}/${projectName ? encodeURIComponent(projectName) : ''}/${id}/index.html`,
          size: '',
          sizeBytes: 0,
        };

        if (noFilters || shouldFilterByProject || shouldFilterByID) {
          reports.push(report);
        }
      });

      reportsStream.on('error', (err) => {
        reject(err);
      });

      reportsStream.on('end', async () => {
        const getTimestamp = (date?: Date | string) => {
          if (!date) return 0;
          if (typeof date === 'string') return new Date(date).getTime();

          return date.getTime();
        };

        reports.sort((a, b) => getTimestamp(b.createdAt) - getTimestamp(a.createdAt));

        const currentReports = handlePagination<Report>(reports, input?.pagination);

        const withMetadata = await this.getReportsMetadata(currentReports as ReportHistory[]);

        let filteredReports = withMetadata;

        // Filter by search if provided
        if (input?.search && input.search.trim()) {
          const searchTerm = input.search.toLowerCase().trim();

          filteredReports = filteredReports.filter((report) => {
            // Search in title, reportID, project, and all metadata fields
            const searchableFields = [
              report.title,
              report.reportID,
              report.project,
              ...Object.entries(report)
                .filter(
                  ([key]) =>
                    !['reportID', 'title', 'createdAt', 'size', 'sizeBytes', 'project', 'reportUrl', 'stats'].includes(
                      key,
                    ),
                )
                .map(([key, value]) => `${key}: ${value}`),
            ].filter(Boolean);

            return searchableFields.some((field) => field?.toLowerCase().includes(searchTerm));
          });
        }

        const finalReports = handlePagination(filteredReports, input?.pagination);

        resolve({
          reports: finalReports.map((report) => {
            const sizeBytes = reportSizes.get(report.reportID) ?? 0;

            return {
              ...report,
              sizeBytes,
              size: bytesToString(sizeBytes),
            };
          }),
          total: filteredReports.length,
        });
      });
    });
  }

  async getReportsMetadata(reports: ReportHistory[]): Promise<ReportHistory[]> {
    return await processBatch<ReportHistory, ReportHistory>(this, reports, this.batchSize, async (report) => {
      console.log(`[s3.batch] reading report ${report.reportID} metadata`);

      const { result: metadata, error: metadataError } = await withError(
        this.readOrParseReportMetadata(report.reportID, report.project),
      );

      if (metadataError) {
        console.error(`[s3] failed to read or create metadata for ${report.reportID}: ${metadataError.message}`);

        return report;
      }

      if (!metadata) {
        return report;
      }

      return Object.assign(metadata, report);
    });
  }

  async readOrParseReportMetadata(id: string, projectName: string): Promise<ReportHistory> {
    console.log(`[s3] checking metadata for report ${projectName}/${id}`);

    const { result: metadataContent, error: metadataError } = await withError(
      this.readFile(path.join(REPORTS_BUCKET, projectName, id, REPORT_METADATA_FILE), 'utf-8'),
    );

    if (metadataError) console.error(`[s3] failed to read metadata for ${id}: ${metadataError.message}`);

    const metadata = metadataContent && !metadataError ? JSON.parse(metadataContent.toString()) : {};

    if (isReportHistory(metadata)) {
      console.log(`metadata found for report ${id}`);

      return metadata;
    }

    console.log(`metadata file not found for ${id}, creating new metadata`);
    try {
      const { result: htmlContent, error: htmlError } = await withError(
        this.readFile(path.join(REPORTS_BUCKET, projectName, id, 'index.html'), 'utf-8'),
      );

      if (htmlError) console.error(`[s3] failed to read index.html for ${id}: ${htmlError.message}`);

      const created = await this.parseReportMetadata(
        id,
        path.join(REPORTS_FOLDER, projectName, id),
        {
          project: projectName,
          reportID: id,
        },
        htmlContent?.toString(),
      );

      console.log(`metadata object created for ${id}: ${JSON.stringify(created)}`);

      await this.saveReportMetadata(id, path.join(REPORTS_FOLDER, projectName, id), created);

      Object.assign(metadata, created);
    } catch (e) {
      console.error(`failed to create metadata for ${id}: ${(e as Error).message}`);
    }

    return metadata;
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

  async saveResult(file: Blob, size: number, resultDetails: ResultDetails) {
    const resultID = randomUUID();

    const metaData = {
      resultID,
      createdAt: new Date().toISOString(),
      project: resultDetails?.project ?? '',
      ...resultDetails,
      size: bytesToString(size),
      sizeBytes: size,
    };

    await this.write(RESULTS_BUCKET, [
      {
        name: `${resultID}.zip`,
        content: transformBlobToReadable(file),
        size,
      },
      {
        name: `${resultID}.json`,
        content: JSON.stringify(metaData),
      },
    ]);

    return metaData as Result;
  }

  private async uploadReport(reportId: string, reportPath: string, remotePath: string) {
    console.log(`[s3] upload report: ${reportPath}`);

    const files = await fs.readdir(reportPath, { recursive: true, withFileTypes: true });

    await processBatch(this, files, this.batchSize, async (file) => {
      if (!file.isFile()) {
        return;
      }

      console.log(`[s3] uploading file: ${JSON.stringify(file)}`);

      const nestedPath = (file as any).path.split(reportId).pop();
      const s3Path = path.join(remotePath, nestedPath ?? '', file.name);

      console.log(`[s3] uploading to ${s3Path}`);

      const { error } = await withError(this.uploadFileWithRetry(s3Path, path.join((file as any).path, file.name)));

      if (error) {
        console.error(`[s3] failed to upload report: ${error.message}`);
        throw new Error(`[s3] failed to upload report: ${error.message}`);
      }
    });
  }

  private async uploadFileWithRetry(remotePath: string, filePath: string, attempt = 1): Promise<void> {
    if (attempt > 3) {
      throw new Error(`[s3] failed to upload file after ${attempt} attempts: ${filePath}`);
    }
    const { error } = await withError(this.client.fPutObject(this.bucket, remotePath, filePath, {}));

    if (error) {
      console.error(`[s3] failed to upload file: ${error.message}`);
      console.log(`[s3] will retry in 3s...`);

      return await this.uploadFileWithRetry(remotePath, filePath, attempt + 1);
    }
  }

  private async clearTempFolders(id?: string) {
    const withReportPathMaybe = id ? ` for report ${id}` : '';

    console.log(`[s3] clear temp folders${withReportPathMaybe}`);

    await withError(fs.rm(path.join(TMP_FOLDER, id ?? ''), { recursive: true, force: true }));
    await withError(fs.rm(REPORTS_FOLDER, { recursive: true, force: true }));
  }

  async generateReport(resultsIds: string[], metadata?: ReportMetadata): Promise<UUID> {
    console.log(`[s3] generate report from results: ${JSON.stringify(resultsIds)}`);
    console.log(`[s3] create temp folders`);
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

      const id = fileName.replace(path.extname(fileName), '');

      if (resultsIds.includes(id)) {
        console.log(`[s3] file id is in target results, downloading...`);
        const localFilePath = path.join(tempFolder, fileName);

        const { error } = await withError(this.client.fGetObject(this.bucket, result.name, localFilePath));

        if (error) {
          console.error(`[s3] failed to download ${result.name}: ${error.message}`);

          throw new Error(`failed to download ${result.name}: ${error.message}`);
        }

        console.log(`[s3] Downloaded: ${result.name} to ${localFilePath}`);
      }
    }

    const { reportPath } = await generatePlaywrightReport(reportId, metadata?.project);

    console.log(`[s3] report generated: ${reportId} | ${reportPath}`);

    const { result: info, error: parseReportMetadataError } = await withError(
      this.parseReportMetadata(reportId, reportPath, metadata),
    );

    if (parseReportMetadataError) console.error(parseReportMetadataError.message);

    const remotePath = path.join(REPORTS_BUCKET, metadata?.project ?? '', reportId);

    const { error: uploadError } = await withError(this.uploadReport(reportId, reportPath, remotePath));

    if (uploadError) {
      console.error(`[s3] failed to upload report: ${uploadError.message}`);
    } else {
      const { error } = await withError(this.saveReportMetadata(reportId, reportPath, info ?? metadata ?? {}));

      if (error) console.error(`[s3] failed to save report metadata: ${error.message}`);
    }

    await this.clearTempFolders(reportId);

    return reportId;
  }

  private async saveReportMetadata(reportId: string, reportPath: string, metadata: ReportMetadata) {
    console.log(`[s3] report uploaded: ${reportId}, uploading metadata to ${reportPath}`);
    const { error: metadataError } = await withError(
      this.write(path.join(REPORTS_BUCKET, metadata.project ?? '', reportId), [
        {
          name: REPORT_METADATA_FILE,
          content: JSON.stringify(metadata),
        },
      ]),
    );

    if (metadataError) console.error(`[s3] failed to upload report metadata: ${metadataError.message}`);
  }

  private async parseReportMetadata(
    reportId: string,
    reportPath: string,
    metadata?: Record<string, string>,
    htmlContent?: string, // to pass file content if stored on s3
  ): Promise<ReportMetadata> {
    console.log(`[s3] creating report metadata for ${reportId} and ${reportPath}`);
    const html = htmlContent ?? (await fs.readFile(path.join(reportPath, 'index.html'), 'utf-8'));

    const info = await parse(html as string);

    const content = Object.assign(info, metadata, {
      reportId,
      createdAt: new Date().toISOString(),
    });

    return content;
  }

  async readConfigFile(): Promise<{ result?: SiteWhiteLabelConfig; error: Error | null }> {
    console.log(`[s3] checking config file`);

    const { result: stream, error } = await withError(this.client.getObject(this.bucket, APP_CONFIG_S3));

    if (error) {
      console.error(`[s3] failed to read config file: ${error.message}`);

      return { error };
    }

    let existingConfig = '';

    for await (const chunk of stream ?? []) {
      existingConfig += chunk.toString();
    }

    try {
      const parsed = JSON.parse(existingConfig);

      const isValid = isConfigValid(parsed);

      if (!isValid) {
        return { error: new Error('invalid config') };
      }

      // ensure custom images available locally in data folder
      for (const image of [
        { path: parsed.faviconPath, default: defaultConfig.faviconPath },
        { path: parsed.logoPath, default: defaultConfig.logoPath },
      ]) {
        if (!image) continue;
        if (image.path === image.default) continue;

        const localPath = path.join(DATA_FOLDER, image.path);
        const { error: accessError } = await withError(fs.access(localPath));

        if (accessError) {
          const remotePath = path.join(DATA_PATH, image.path);

          console.log(`[s3] downloading config image: ${remotePath} to ${localPath}`);
          await this.client.fGetObject(this.bucket, remotePath, localPath);
        }
      }

      return { result: parsed, error: null };
    } catch (e) {
      return { error: new Error(`failed to parse config: ${e instanceof Error ? e.message : e}`) };
    }
  }

  async saveConfigFile(config: Partial<SiteWhiteLabelConfig>) {
    console.log(`[s3] writing config file`);

    const { result: existingConfig, error: readExistingConfigError } = await this.readConfigFile();

    if (readExistingConfigError) {
      console.error(`[s3] failed to read existing config file: ${readExistingConfigError.message}`);
    }

    await this.clear(APP_CONFIG_S3);

    const uploadConfig = { ...(existingConfig ?? {}), ...config } as SiteWhiteLabelConfig;

    if (config.logoPath && config.logoPath !== existingConfig?.logoPath && config.logoPath !== defaultConfig.logoPath) {
      await this.uploadConfigImage(config.logoPath);
    }

    if (
      config.faviconPath &&
      config.faviconPath !== existingConfig?.faviconPath &&
      config.faviconPath !== defaultConfig.faviconPath
    ) {
      await this.uploadConfigImage(config.faviconPath);
    }

    const { error } = await withError(
      this.write(DATA_PATH, [
        {
          name: 'config.json',
          content: JSON.stringify(uploadConfig, null, 2),
        },
      ]),
    );

    if (error) console.error(`[s3] failed to write config file: ${error.message}`);

    return { result: uploadConfig, error };
  }

  private async uploadConfigImage(imagePath: string): Promise<Error | null> {
    console.log(`[s3] uploading config image: ${imagePath}`);

    const localPath = path.join(DATA_FOLDER, imagePath);
    const remotePath = path.join(DATA_PATH, imagePath);

    const { error } = await withError(this.uploadFileWithRetry(remotePath, localPath));

    if (error) {
      console.error(`[s3] failed to upload config image: ${error.message}`);

      return error;
    }

    return null;
  }
}

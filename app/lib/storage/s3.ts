import { randomUUID, type UUID } from 'node:crypto';
import { createWriteStream, createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  type _Object,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { processBatch } from './batch';
import {
  Result,
  Report,
  ResultDetails,
  ServerDataInfo,
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

import { parse } from '@/app/lib/parser';
import { serveReportRoute } from '@/app/lib/constants';
import { generatePlaywrightReport } from '@/app/lib/pw';
import { withError } from '@/app/lib/withError';
import { env } from '@/app/config/env';
import { SiteWhiteLabelConfig } from '@/app/types';
import { defaultConfig, isConfigValid } from '@/app/lib/config';
import { getTimestamp } from '@/app/lib/time';

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

  const protocol = 'https://';
  const endpointUrl = port ? `${protocol}${endPoint}:${port}` : `${protocol}${endPoint}`;

  const client = new S3Client({
    region: region || 'us-east-1',
    endpoint: endpointUrl,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
    forcePathStyle: true, // required for S3-compatible services like Minio
  });

  return client;
};

export class S3 implements Storage {
  private static instance: S3;
  private readonly client: S3Client;
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
    const { error } = await withError(this.client.send(new HeadBucketCommand({ Bucket: this.bucket })));

    if (!error) {
      return;
    }

    if (error.name === 'NotFound') {
      console.log(`[s3] bucket ${this.bucket} does not exist, creating...`);

      const { error } = await withError(
        this.client.send(
          new CreateBucketCommand({
            Bucket: this.bucket,
          }),
        ),
      );

      if (error) {
        console.error('[s3] failed to create bucket:', error);
      }
    }

    console.error('[s3] failed to check that bucket exist:', error);
  }

  private async write(dir: string, files: { name: string; content: Readable | Buffer | string; size?: number }[]) {
    await this.ensureBucketExist();
    for (const file of files) {
      const filePath = path.join(dir, file.name);

      console.log(`[s3] writing ${filePath}`);

      const content = typeof file.content === 'string' ? Buffer.from(file.content) : file.content;

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: path.normalize(filePath),
          Body: content,
        }),
      );
    }
  }

  private async read(targetPath: string, contentType?: string | null) {
    await this.ensureBucketExist();
    console.log(`[s3] read ${targetPath}`);

    const remotePath = targetPath.includes(REPORTS_BUCKET) ? targetPath : `${REPORTS_BUCKET}/${targetPath}`;

    console.log(`[s3] reading from remote path: ${remotePath}`);

    const { result: response, error } = await withError(
      this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: remotePath,
        }),
      ),
    );

    if (error ?? !response?.Body) {
      return { result: null, error };
    }

    const stream = response.Body as Readable;

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
    // avoid using "removeObjects" as it is not supported by every S3-compatible provider
    // for example, Google Cloud Storage.
    await processBatch<string, void>(this, path, this.batchSize, async (object) => {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: object,
        }),
      );
    });
  }

  async getFolderSize(folderPath: string): Promise<{ size: number; resultCount: number; indexCount: number }> {
    let resultCount = 0;
    let indexCount = 0;
    let totalSize = 0;

    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: folderPath,
          ContinuationToken: continuationToken,
        }),
      );

      for (const obj of response.Contents ?? []) {
        if (obj.Key?.endsWith('.zip')) {
          resultCount += 1;
        }

        if (obj.Key?.endsWith('index.html') && !obj.Key.includes('/trace/index.html')) {
          indexCount += 1;
        }

        totalSize += obj?.Size ?? 0;
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return { size: totalSize, resultCount, indexCount };
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

    const jsonFiles: _Object[] = [];
    const resultSizes = new Map<string, number>();

    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: RESULTS_BUCKET,
          ContinuationToken: continuationToken,
        }),
      );

      for (const file of response.Contents ?? []) {
        if (!file?.Key) {
          continue;
        }

        if (file.Key.endsWith('.zip')) {
          const resultID = path.basename(file.Key, '.zip');

          resultSizes.set(resultID, file.Size ?? 0);
        }

        if (file.Key.endsWith('.json')) {
          jsonFiles.push(file);
        }
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

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

    jsonFiles.sort((a, b) => getTimestamp(b.LastModified) - getTimestamp(a.LastModified));

    // check if we can apply pagination early
    const noFilters = !input?.project && !input?.pagination;

    const resultFiles = noFilters ? handlePagination(jsonFiles, input?.pagination) : jsonFiles;

    const results = await processBatch<_Object, Result>(this, resultFiles, this.batchSize, async (file) => {
      console.log(`[s3.batch] reading result: ${JSON.stringify(file)}`);
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: file.Key!,
        }),
      );

      const stream = response.Body as Readable;
      let jsonString = '';

      for await (const chunk of stream) {
        jsonString += chunk.toString();
      }

      const parsed = JSON.parse(jsonString);

      return parsed;
    });

    let filteredResults = results.filter((file) => (input?.project ? file.project === input.project : file));

    // Filter by tags if provided
    if (input?.tags && input.tags.length > 0) {
      const notMetadataKeys = new Set(['resultID', 'title', 'createdAt', 'size', 'sizeBytes', 'project']);

      filteredResults = filteredResults.filter((result) => {
        const resultTags = Object.entries(result)
          .filter(([key]) => !notMetadataKeys.has(key))
          .map(([key, value]) => `${key}: ${value}`);

        return input.tags!.some((selectedTag) => resultTags.includes(selectedTag));
      });
    }

    // Filter by search if provided
    if (input?.search?.trim()) {
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

    const reports: Report[] = [];
    const reportSizes = new Map<string, number>();

    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: REPORTS_BUCKET,
          ContinuationToken: continuationToken,
        }),
      );

      for (const file of response.Contents ?? []) {
        if (!file?.Key) {
          continue;
        }

        const reportID = getFileReportID(file.Key);

        const newSize = (reportSizes.get(reportID) ?? 0) + (file.Size ?? 0);

        reportSizes.set(reportID, newSize);

        if (!file.Key.endsWith('index.html') || file.Key.includes('trace')) {
          continue;
        }

        const dir = path.dirname(file.Key);
        const id = path.basename(dir);
        const parentDir = path.basename(path.dirname(dir));

        const projectName = parentDir === REPORTS_PATH ? '' : parentDir;

        const noFilters = !input?.project && !input?.ids;

        const shouldFilterByProject = input?.project && projectName === input.project;

        const shouldFilterByID = input?.ids?.includes(id);

        const report = {
          reportID: id,
          project: projectName,
          createdAt: file.LastModified ?? new Date(),
          reportUrl: `${serveReportRoute}/${projectName ? encodeURIComponent(projectName) : ''}/${id}/index.html`,
          size: '',
          sizeBytes: 0,
        };

        if (noFilters || shouldFilterByProject || shouldFilterByID) {
          reports.push(report);
        }
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

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
                !['reportID', 'title', 'createdAt', 'size', 'sizeBytes', 'project', 'reportUrl', 'stats'].includes(key),
            )
            .map(([key, value]) => `${key}: ${value}`),
        ].filter(Boolean);

        return searchableFields.some((field) => field?.toLowerCase().includes(searchTerm));
      });
    }

    const finalReports = handlePagination(filteredReports, input?.pagination);

    return {
      reports: finalReports.map((report) => {
        const sizeBytes = reportSizes.get(report.reportID) ?? 0;

        return {
          ...report,
          sizeBytes,
          size: bytesToString(sizeBytes),
        };
      }),
      total: filteredReports.length,
    };
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
    const files: string[] = [];

    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: REPORTS_BUCKET,
          ContinuationToken: continuationToken,
        }),
      );

      for (const file of response.Contents ?? []) {
        if (!file?.Key) {
          continue;
        }

        const reportID = path.basename(path.dirname(file.Key));

        if (reportsIDs.includes(reportID)) {
          files.push(file.Key);
        }
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return files;
  }

  async deleteReports(reportIDs: string[]): Promise<void> {
    const objects = await this.getReportObjects(reportIDs);

    await withError(this.clear(...objects));
  }

  async generatePresignedUploadUrl(fileName: string) {
    await this.ensureBucketExist();
    const objectKey = path.join(RESULTS_BUCKET, fileName);
    const expiry = 30 * 60; // 30 minutes

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
    });

    return await getSignedUrl(this.client, command, { expiresIn: expiry });
  }

  async saveResult(filename: string, stream: PassThrough) {
    await this.ensureBucketExist();

    const chunkSizeMB = env.S3_MULTIPART_CHUNK_SIZE_MB;
    const chunkSize = chunkSizeMB * 1024 * 1024; // bytes

    console.log(`[s3] starting multipart upload for ${filename} with chunk size ${chunkSizeMB}MB`);

    const remotePath = path.join(RESULTS_BUCKET, filename);

    const { UploadId: uploadID } = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: remotePath,
      }),
    );

    if (!uploadID) {
      throw new Error('[s3] failed to initiate multipart upload: no UploadId received');
    }

    const uploadedParts: { PartNumber: number; ETag: string }[] = [];
    let partNumber = 1;
    let buffer = Buffer.alloc(0);

    try {
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);

        while (buffer.length >= chunkSize) {
          const partData = buffer.subarray(0, chunkSize);

          buffer = buffer.subarray(chunkSize);

          console.log(
            `[s3] uploading part ${partNumber} (${(partData.length / (1024 * 1024)).toFixed(2)}MB) for ${filename}`,
          );

          const uploadPartResult = await this.client.send(
            new UploadPartCommand({
              Bucket: this.bucket,
              Key: remotePath,
              UploadId: uploadID,
              PartNumber: partNumber,
              Body: partData,
            }),
          );

          if (!uploadPartResult.ETag) {
            throw new Error(`[s3] failed to upload part ${partNumber}: no ETag received`);
          }

          uploadedParts.push({
            PartNumber: partNumber,
            ETag: uploadPartResult.ETag,
          });

          partNumber++;
        }
      }

      if (buffer.length > 0) {
        console.log(`[s3] uploading final part ${partNumber} [${bytesToString(buffer.length)}] for ${filename}`);

        const uploadPartResult = await this.client.send(
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: remotePath,
            UploadId: uploadID,
            PartNumber: partNumber,
            Body: buffer,
          }),
        );

        if (!uploadPartResult.ETag) {
          throw new Error(`[s3] failed to upload final part ${partNumber}: no ETag received`);
        }

        uploadedParts.push({
          PartNumber: partNumber,
          ETag: uploadPartResult.ETag,
        });
      }

      console.log(`[s3] completing multipart upload for ${filename} with ${uploadedParts.length} parts`);

      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: remotePath,
          UploadId: uploadID,
          MultipartUpload: {
            Parts: uploadedParts,
          },
        }),
      );

      console.log(`[s3] multipart upload completed successfully for ${filename}`);
    } catch (error) {
      console.error(`[s3] multipart upload failed, aborting: ${(error as Error).message}`);

      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: remotePath,
          UploadId: uploadID,
        }),
      );

      throw error;
    }
  }

  async saveResultDetails(resultID: string, resultDetails: ResultDetails, size: number): Promise<Result> {
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

    const fileStream = createReadStream(filePath);

    const { error } = await withError(
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: remotePath,
          Body: fileStream,
        }),
      ),
    );

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

    console.log(`[s3] start processing...`);

    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: RESULTS_BUCKET,
          ContinuationToken: continuationToken,
        }),
      );

      for (const result of response.Contents ?? []) {
        if (!result.Key) continue;

        const fileName = path.basename(result.Key);

        const id = fileName.replace(path.extname(fileName), '');

        if (resultsIds.includes(id) && path.extname(fileName) === '.zip') {
          console.log(`[s3] file id is in target results, downloading...`);
          const localFilePath = path.join(tempFolder, fileName);

          const { error } = await withError(
            (async () => {
              const response = await this.client.send(
                new GetObjectCommand({
                  Bucket: this.bucket,
                  Key: result.Key!,
                }),
              );

              const stream = response.Body as Readable;
              const writeStream = createWriteStream(localFilePath);

              return new Promise<void>((resolve, reject) => {
                stream.pipe(writeStream);
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
                stream.on('error', reject);
              });
            })(),
          );

          if (error) {
            console.error(`[s3] failed to download ${result.Key}: ${error.message}`);

            throw new Error(`failed to download ${result.Key}: ${error.message}`);
          }

          console.log(`[s3] Downloaded: ${result.Key} to ${localFilePath}`);
        }
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    const { reportPath } = await generatePlaywrightReport(reportId, metadata!);

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
    await this.ensureBucketExist();
    console.log(`[s3] checking config file`);

    const { result: response, error } = await withError(
      this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: APP_CONFIG_S3,
        }),
      ),
    );

    if (error) {
      console.error(`[s3] failed to read config file: ${error.message}`);

      return { error };
    }

    const stream = response?.Body as Readable;
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

          const response = await this.client.send(
            new GetObjectCommand({
              Bucket: this.bucket,
              Key: remotePath,
            }),
          );

          const stream = response.Body as Readable;
          const writeStream = createWriteStream(localPath);

          await new Promise<void>((resolve, reject) => {
            stream.pipe(writeStream);
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
            stream.on('error', reject);
          });
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

    const { error: clearExistingConfigError } = await withError(this.clear(APP_CONFIG_S3));

    if (clearExistingConfigError) {
      console.error(`[s3] failed to clear existing config file: ${clearExistingConfigError.message}`);
    }

    const uploadConfig = { ...(existingConfig ?? {}), ...config } as SiteWhiteLabelConfig;

    const isDefaultImage = (key: keyof SiteWhiteLabelConfig) => config[key] && config[key] === defaultConfig[key];

    const shouldBeUploaded = async (key: keyof SiteWhiteLabelConfig) => {
      if (!config[key]) return false;
      if (isDefaultImage(key)) return false;

      const imagePath = key === 'logoPath' ? uploadConfig.logoPath : uploadConfig.faviconPath;

      const { result } = await withError(
        this.client.send(
          new HeadObjectCommand({
            Bucket: this.bucket,
            Key: path.join(DATA_PATH, imagePath),
          }),
        ),
      );

      if (!result) {
        return true;
      }

      return false;
    };

    if (await shouldBeUploaded('logoPath')) {
      await this.uploadConfigImage(uploadConfig.logoPath);
    }

    if (await shouldBeUploaded('faviconPath')) {
      await this.uploadConfigImage(uploadConfig.faviconPath);
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

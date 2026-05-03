import { randomUUID, type UUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { SiteWhiteLabelConfig } from '@playwright-reports/shared';
import getFolderSize from 'get-folder-size';
import { type Entry, Parse } from 'unzipper';
import { env } from '../../config/env.js';
import { withError } from '../../lib/withError.js';
import { defaultConfig, isConfigValid } from '../config.js';
import { serveReportRoute } from '../constants.js';
import { parse } from '../parser/index.js';
import { generatePlaywrightReport } from '../pw.js';
import { processWithConcurrency, Semaphore } from '../utils/semaphore.js';
import {
  APP_CONFIG_S3,
  DATA_FOLDER,
  DATA_PATH,
  REPORTS_BUCKET,
  REPORTS_FOLDER,
  RESULTS_BUCKET,
  TMP_FOLDER,
} from './constants.js';
import { bytesToString } from './format.js';
import type {
  ReportHistory,
  ReportMetadata,
  ReportPath,
  ServerDataInfo,
  Storage,
} from './types.js';

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
    // S3-compatible services like Minio require path-style addressing.
    forcePathStyle: true,
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
    const { error } = await withError(
      this.client.send(new HeadBucketCommand({ Bucket: this.bucket }))
    );

    if (!error) {
      return;
    }

    if (error.name === 'NotFound') {
      console.log(`[s3] bucket ${this.bucket} does not exist, creating...`);

      const { error: createError } = await withError(
        this.client.send(
          new CreateBucketCommand({
            Bucket: this.bucket,
          })
        )
      );

      if (createError) {
        console.error('[s3] failed to create bucket:', createError);
      }

      return;
    }

    console.error('[s3] failed to check that bucket exists:', error);
  }

  private async write(
    dir: string,
    files: {
      name: string;
      content: Readable | Buffer | string;
      size?: number;
    }[]
  ) {
    await this.ensureBucketExist();
    for (const file of files) {
      const filePath = path.join(dir, file.name);

      const content = typeof file.content === 'string' ? Buffer.from(file.content) : file.content;

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: path.normalize(filePath),
          Body: content,
        })
      );
    }
  }

  private async read(targetPath: string, contentType?: string | null) {
    await this.ensureBucketExist();

    const remotePath = targetPath.includes(REPORTS_BUCKET)
      ? targetPath
      : `${REPORTS_BUCKET}/${targetPath}`;

    const { result: response, error } = await withError(
      this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: remotePath,
        })
      )
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
    // Avoid `removeObjects`: not supported by every S3-compatible provider (e.g. GCS).
    await processWithConcurrency(path, this.batchSize, async (object) => {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: object,
        })
      );
    });
  }

  async getFolderSize(
    folderPath: string
  ): Promise<{ size: number; resultCount: number; indexCount: number }> {
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
        })
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

    const [results, reports] = await Promise.all([
      this.getFolderSize(RESULTS_BUCKET),
      this.getFolderSize(REPORTS_BUCKET),
    ]);

    const dataSize = results.size + reports.size;
    const availableSizeinMB = 'Unlimited';

    return {
      dataFolderSizeinMB: bytesToString(dataSize),
      numOfResults: results.resultCount,
      resultsFolderSizeinMB: bytesToString(results.size),
      numOfReports: reports.indexCount,
      reportsFolderSizeinMB: bytesToString(reports.size),
      availableSizeinMB,
    };
  }

  async readFile(targetPath: string, contentType: string | null): Promise<string | Buffer> {
    const { result, error } = await this.read(targetPath, contentType);

    if (error) {
      console.error(`[s3] failed to read file ${targetPath}: ${error.message}`);
      throw new Error(`[s3] failed to read file: ${error.message}`);
    }

    return result!;
  }

  async deleteResults(resultIDs: string[]): Promise<void> {
    const objects = resultIDs.map((id) => `${RESULTS_BUCKET}/${id}.zip`);

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
        })
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

  async deleteReports(reports: ReportPath[]): Promise<void> {
    const ids = reports.map((r) => r.reportID);
    const objects = await this.getReportObjects(ids);

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
    const chunkSize = chunkSizeMB * 1024 * 1024;

    const remotePath = path.join(RESULTS_BUCKET, filename);

    const { UploadId: uploadID } = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: remotePath,
      })
    );

    if (!uploadID) {
      throw new Error('[s3] failed to initiate multipart upload: no UploadId received');
    }

    const uploadedParts: { PartNumber: number; ETag: string }[] = [];
    let partNumber = 1;
    const chunks: Buffer[] = [];
    let currentSize = 0;

    try {
      for await (const chunk of stream) {
        chunks.push(chunk);
        currentSize += chunk.length;

        while (currentSize >= chunkSize) {
          const partData = Buffer.allocUnsafe(chunkSize);
          let copied = 0;

          while (copied < chunkSize && chunks.length > 0) {
            const currentChunk = chunks[0];
            const needed = chunkSize - copied;
            const available = currentChunk.length;

            if (available <= needed) {
              currentChunk.copy(partData, copied);
              copied += available;
              chunks.shift();
            } else {
              currentChunk.copy(partData, copied, 0, needed);
              copied += needed;
              chunks[0] = currentChunk.subarray(needed);
            }
          }

          currentSize -= chunkSize;

          stream.pause();

          const uploadPartResult = await this.client.send(
            new UploadPartCommand({
              Bucket: this.bucket,
              Key: remotePath,
              UploadId: uploadID,
              PartNumber: partNumber,
              Body: partData,
            })
          );

          // Zero the buffer so GC can reclaim it sooner.
          partData.fill(0);

          stream.resume();

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

      if (currentSize > 0) {
        const finalPart = Buffer.allocUnsafe(currentSize);
        let offset = 0;

        for (const chunk of chunks) {
          chunk.copy(finalPart, offset);
          offset += chunk.length;
        }

        const uploadPartResult = await this.client.send(
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: remotePath,
            UploadId: uploadID,
            PartNumber: partNumber,
            Body: finalPart,
          })
        );

        chunks.length = 0;
        finalPart.fill(0);

        if (!uploadPartResult.ETag) {
          throw new Error(`[s3] failed to upload final part ${partNumber}: no ETag received`);
        }

        uploadedParts.push({
          PartNumber: partNumber,
          ETag: uploadPartResult.ETag,
        });
      }

      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: remotePath,
          UploadId: uploadID,
          MultipartUpload: {
            Parts: uploadedParts,
          },
        })
      );

      console.log(`[s3] uploaded ${filename} (${uploadedParts.length} parts)`);
    } catch (error) {
      console.error(`[s3] multipart upload failed, aborting: ${(error as Error).message}`);

      await this.client.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: remotePath,
          UploadId: uploadID,
        })
      );

      throw error;
    }
  }

  private async uploadReport(reportId: string, reportPath: string, remotePath: string) {
    const files = await fs.readdir(reportPath, {
      recursive: true,
      withFileTypes: true,
    });

    await processWithConcurrency(files, this.batchSize, async (file) => {
      if (!file.isFile()) {
        return;
      }

      const nestedPath = (file as any).path.split(reportId).pop();
      const s3Path = path.join(remotePath, nestedPath ?? '', file.name);

      const { error } = await withError(
        this.uploadFileWithRetry(s3Path, path.join((file as any).path, file.name))
      );

      if (error) {
        console.error(`[s3] failed to upload report: ${error.message}`);
        throw new Error(`[s3] failed to upload report: ${error.message}`);
      }
    });
  }

  private async uploadFileWithRetry(
    remotePath: string,
    filePath: string,
    attempt = 1
  ): Promise<void> {
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
        })
      )
    );

    if (error) {
      console.error(`[s3] failed to upload file: ${error.message}, retrying in 3s...`);

      return await this.uploadFileWithRetry(remotePath, filePath, attempt + 1);
    }
  }

  private async clearTempFolders(id?: string) {
    await withError(fs.rm(path.join(TMP_FOLDER, id ?? ''), { recursive: true, force: true }));
    await withError(fs.rm(REPORTS_FOLDER, { recursive: true, force: true }));
  }

  async generateReport(
    resultsIds: string[],
    metadata?: ReportMetadata
  ): Promise<{ reportId: UUID; reportPath: string; report: ReportHistory }> {
    console.log(`[s3] generating report from ${resultsIds.length} result(s)`);
    const { error: mkdirReportsError } = await withError(
      fs.mkdir(REPORTS_FOLDER, { recursive: true })
    );

    if (mkdirReportsError) {
      console.error(`[s3] failed to create reports folder: ${mkdirReportsError.message}`);
    }

    const reportId = randomUUID();
    const tempFolder = path.join(TMP_FOLDER, reportId);

    const { error: mkdirTempError } = await withError(fs.mkdir(tempFolder, { recursive: true }));

    if (mkdirTempError) {
      console.error(`[s3] failed to create temporary folder: ${mkdirTempError.message}`);
    }

    for (const resultId of resultsIds) {
      const fileName = `${resultId}.zip`;

      // Reuse a local copy if one is already on disk to skip the round trip.
      const temporaryPath = path.join(TMP_FOLDER, 'results', fileName);
      const { error: temporaryFileExistError } = await withError(fs.access(temporaryPath));
      if (!temporaryFileExistError) {
        const { error: copyError } = await withError(
          fs.copyFile(temporaryPath, path.join(tempFolder, fileName))
        );

        if (copyError) {
          console.error(
            `[s3] failed to copy existing result file for ${resultId}: ${copyError.message}`
          );
          break;
        }

        continue;
      }

      const objectKey = path.join(RESULTS_BUCKET, fileName);

      const { error: headError } = await withError(
        this.client.send(
          new HeadObjectCommand({
            Bucket: this.bucket,
            Key: objectKey,
          })
        )
      );

      if (headError) {
        console.error(`[s3] result ${resultId} not found, skipping: ${headError.message}`);
        throw new Error(`failed to check ${objectKey}: ${headError.message}`);
      }

      const localFilePath = path.join(tempFolder, fileName);

      const { error: downloadError } = await withError(
        (async () => {
          const response = await this.client.send(
            new GetObjectCommand({
              Bucket: this.bucket,
              Key: objectKey,
            })
          );

          const stream = response.Body as Readable;
          const writeStream = createWriteStream(localFilePath);

          return new Promise<void>((resolve, reject) => {
            stream.pipe(writeStream);
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
            stream.on('error', reject);
          });
        })()
      );

      if (downloadError) {
        console.error(`[s3] failed to download ${objectKey}: ${downloadError.message}`);

        throw new Error(`failed to download ${objectKey}: ${downloadError.message}`);
      }
    }

    const { reportPath } = await generatePlaywrightReport(reportId, metadata!);

    const sizeBytes = await getFolderSize.loose(reportPath);
    console.log(`[s3] report ${reportId} generated (${bytesToString(sizeBytes)})`);

    const { result: info, error: parseReportMetadataError } = await withError(
      this.parseReportMetadata(reportId, reportPath, metadata, undefined, sizeBytes)
    );

    if (parseReportMetadataError) console.error(parseReportMetadataError.message);

    const remotePath = path.join(REPORTS_BUCKET, reportId);

    const { error: uploadError } = await withError(
      this.uploadReport(reportId, reportPath, remotePath)
    );

    if (uploadError) {
      console.error(`[s3] failed to upload report: ${uploadError.message}`);
    }

    await this.clearTempFolders(reportId);

    return {
      reportId,
      reportPath,
      report: (info ?? metadata ?? {}) as unknown as ReportHistory,
    };
  }

  private async parseReportMetadata(
    reportId: string,
    reportPath: string,
    metadata?: ReportMetadata,
    // Optionally provide the file's content directly (when it lives on S3, not on disk).
    htmlContent?: string,
    sizeBytes?: number
  ): Promise<ReportMetadata> {
    const html = htmlContent ?? (await fs.readFile(path.join(reportPath, 'index.html'), 'utf-8'));

    const info = await parse(html as string);

    const content = Object.assign(
      info,
      {
        reportID: reportId,
        createdAt: info.startTime ? new Date(info.startTime).toISOString() : new Date().toISOString(),
        reportUrl: `${serveReportRoute}/${reportId}/index.html`,
        project: '',
      },
      sizeBytes !== undefined ? { sizeBytes, size: bytesToString(sizeBytes) } : {},
      metadata ?? {}
    );

    if (metadata?.displayNumber) {
      content.displayNumber = metadata.displayNumber;
    }

    return content;
  }

  async readConfigFile(): Promise<{
    result?: SiteWhiteLabelConfig;
    error: Error | null;
  }> {
    await this.ensureBucketExist();

    const { result: response, error } = await withError(
      this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: APP_CONFIG_S3,
        })
      )
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

      // Pull custom logo/favicon down so they are served locally without an S3 round trip.
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
            })
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
      return {
        error: new Error(`failed to parse config: ${e instanceof Error ? e.message : e}`),
      };
    }
  }

  async saveConfigFile(config: Partial<SiteWhiteLabelConfig>) {
    const { result: existingConfig, error: readExistingConfigError } = await this.readConfigFile();

    if (readExistingConfigError) {
      console.error(`[s3] failed to read existing config file: ${readExistingConfigError.message}`);
    }

    const { error: clearExistingConfigError } = await withError(this.clear(APP_CONFIG_S3));

    if (clearExistingConfigError) {
      console.error(
        `[s3] failed to clear existing config file: ${clearExistingConfigError.message}`
      );
    }

    const uploadConfig = {
      ...(existingConfig ?? {}),
      ...config,
    } as SiteWhiteLabelConfig;

    const isDefaultImage = (key: keyof SiteWhiteLabelConfig) =>
      config[key] && config[key] === defaultConfig[key];

    const shouldBeUploaded = async (key: keyof SiteWhiteLabelConfig) => {
      if (!config[key]) return false;
      if (isDefaultImage(key)) return false;

      const imagePath = key === 'logoPath' ? uploadConfig.logoPath : uploadConfig.faviconPath;

      const { result } = await withError(
        this.client.send(
          new HeadObjectCommand({
            Bucket: this.bucket,
            Key: path.join(DATA_PATH, imagePath),
          })
        )
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
      ])
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

  async uploadReportFromStream(
    reportId: string,
    zipStream: Readable,
    metadata?: ReportMetadata
  ): Promise<{ reportPath: string; report: ReportHistory }> {
    const remotePath = path.join(REPORTS_BUCKET, reportId);

    const semaphore = new Semaphore(this.batchSize);
    const parser = Parse();
    const uploads: Promise<{ size: number }>[] = [];
    let foundIndexHtml = false;

    parser.on('entry', async (entry: Entry) => {
      if (entry.type !== 'File') {
        entry.autodrain();
        return;
      }

      if (entry.path === 'index.html') {
        foundIndexHtml = true;
      }

      const upload = semaphore.run(async () => {
        const s3Key = path.join(remotePath, entry.path);

        let entrySize = 0;
        const countingPassThrough = new PassThrough({
          transform(chunk, _encoding, callback) {
            entrySize += chunk.length;
            callback(null, chunk);
          },
        });

        entry.pipe(countingPassThrough);

        const uploadResult = await new Upload({
          client: this.client,
          params: {
            Bucket: this.bucket,
            Key: s3Key,
            Body: countingPassThrough,
          },
        }).done();

        if (uploadResult instanceof Error) {
          throw uploadResult;
        }

        return { size: entrySize };
      });

      uploads.push(upload);
    });

    const parsingPromise = new Promise<void>((resolve, reject) => {
      parser.on('error', reject);
      parser.on('close', () => {
        Promise.all(uploads)
          .then(() => resolve())
          .catch(reject);
      });
    });

    await pipeline(zipStream, parser);
    await parsingPromise;

    if (!foundIndexHtml) {
      throw new Error('index.html not found at root of uploaded report ZIP');
    }

    const totalSizeBytes = await Promise.all(uploads).then((results) =>
      results.reduce((sum, { size }) => sum + size, 0)
    );

    const indexHtmlKey = path.join(remotePath, 'index.html');
    const { result: indexObject, error: indexError } = await withError(
      this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: indexHtmlKey,
        })
      )
    );

    if (indexError) {
      throw new Error(`[s3] failed to retrieve index.html: ${indexError.message}`);
    }

    if (!indexObject) {
      throw new Error('index.html not found in uploaded report');
    }

    const htmlContent = await this.streamToString(indexObject.Body as Readable);
    const info = await this.parseReportMetadata(
      reportId,
      remotePath,
      metadata,
      htmlContent,
      totalSizeBytes
    );

    return { reportPath: remotePath, report: info as unknown as ReportHistory };
  }

  private async streamToString(stream: Readable): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8');
  }
}

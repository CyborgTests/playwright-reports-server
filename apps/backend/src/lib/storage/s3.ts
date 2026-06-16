import { randomUUID, type UUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import getFolderSize from 'get-folder-size';
import mime from 'mime';
import { Open } from 'unzipper';
import { env } from '../../config/env.js';
import { withError } from '../../lib/withError.js';
import { serveReportRoute } from '../constants.js';
import { parse } from '../parser/index.js';
import { generatePlaywrightReport } from '../pw.js';
import { resultDb } from '../service/db/index.js';
import { processWithConcurrency, Semaphore } from '../utils/semaphore.js';
import {
  DATA_FOLDER,
  DATA_PATH,
  REPORTS_BUCKET,
  REPORTS_FOLDER,
  RESULTS_BUCKET,
  TMP_FOLDER,
} from './constants.js';
import { bytesToString } from './format.js';
import { safeZipEntryPath } from './streamUtils.js';
import type {
  ReadFileResult,
  ReportHistory,
  ReportPath,
  ReportUploadMetadata,
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

  const protocol = env.S3_USE_SSL ? 'https://' : 'http://';
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

  private async readStream(targetPath: string): Promise<ReadFileResult | null> {
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

    if (error || !response?.Body) {
      if (error) console.error(`[s3] failed to read file ${targetPath}: ${error.message}`);
      return null;
    }

    return {
      body: response.Body as Readable,
      size: typeof response.ContentLength === 'number' ? response.ContentLength : undefined,
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

  // S3 keys must use forward slashes regardless of host OS, so the remote key
  // is built with `path.posix.join` while the local path uses the platform
  // separator. Leading slashes on the stored config path are stripped so we
  // don't produce an absolute path that escapes DATA_FOLDER.
  private resolveBrandingAsset(relativePath: string): {
    localPath: string;
    remoteKey: string;
  } {
    const safeRelative = path.normalize(relativePath).replace(/^[/\\]+/, '');
    return {
      localPath: path.join(DATA_FOLDER, safeRelative),
      remoteKey: path.posix.join(DATA_PATH, safeRelative.split(path.sep).join('/')),
    };
  }

  async uploadBrandingAsset(relativePath: string): Promise<void> {
    const { localPath, remoteKey } = this.resolveBrandingAsset(relativePath);

    const { error: accessError } = await withError(fs.access(localPath));
    if (accessError) {
      throw new Error(`[s3] branding asset not found locally: ${localPath}`);
    }

    console.log(`[s3] uploading branding asset: ${remoteKey}`);
    const { error } = await withError(this.uploadFileWithRetry(remoteKey, localPath));

    if (error) {
      throw new Error(`[s3] failed to upload branding asset ${remoteKey}: ${error.message}`);
    }
  }

  async ensureBrandingAsset(relativePath: string): Promise<void> {
    const { localPath, remoteKey } = this.resolveBrandingAsset(relativePath);

    const { error: missingLocally } = await withError(fs.access(localPath));
    if (!missingLocally) return; // file is on disk, nothing to download

    await fs.mkdir(path.dirname(localPath), { recursive: true });

    const { result: response, error: getError } = await withError(
      this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: remoteKey,
        })
      )
    );

    if (getError || !response?.Body) {
      console.warn(
        `[s3] branding asset not found remotely: ${remoteKey}${getError ? ` (${getError.message})` : ''}`
      );
      return;
    }

    console.log(`[s3] downloading branding asset: ${remoteKey} -> ${localPath}`);
    const stream = response.Body as Readable;
    const writeStream = createWriteStream(localPath);

    try {
      await new Promise<void>((resolve, reject) => {
        stream.pipe(writeStream);
        writeStream.on('finish', () => resolve());
        writeStream.on('error', reject);
        stream.on('error', reject);
      });
    } catch (err) {
      stream.destroy();
      writeStream.destroy();
      await withError(fs.unlink(localPath));
      throw err;
    }
  }

  async deleteBrandingAsset(relativePath: string): Promise<void> {
    const { remoteKey } = this.resolveBrandingAsset(relativePath);
    const { error } = await withError(this.clear(remoteKey));
    if (error) {
      console.warn(`[s3] failed to delete branding asset ${remoteKey}: ${error.message}`);
    }
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

  async readFile(targetPath: string, _contentType: string | null): Promise<ReadFileResult | null> {
    return this.readStream(targetPath);
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

    const chunkSize = env.S3_MULTIPART_CHUNK_SIZE_MB * 1024 * 1024;
    const remotePath = path.join(RESULTS_BUCKET, filename);

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: remotePath,
        Body: stream,
      },
      partSize: chunkSize,
      queueSize: this.batchSize,
    });

    try {
      await upload.done();
      console.log(`[s3] uploaded ${filename}`);
    } catch (error) {
      console.error(`[s3] multipart upload failed: ${(error as Error).message}`);
      throw error;
    }
  }

  private async uploadReport(reportPath: string, remotePath: string) {
    const files = await fs.readdir(reportPath, {
      recursive: true,
      withFileTypes: true,
    });

    await processWithConcurrency(files, this.batchSize, async (file) => {
      if (!file.isFile()) {
        return;
      }

      const relativeDir = path.relative(reportPath, file.parentPath);
      const s3Path = path.posix.join(
        remotePath,
        relativeDir ? relativeDir.split(path.sep).join('/') : '',
        file.name
      );

      const { error } = await withError(
        this.uploadFileWithRetry(s3Path, path.join(file.parentPath, file.name))
      );

      if (error) {
        console.error(`[s3] failed to upload report file ${s3Path}: ${error.message}`);
        throw new Error(`[s3] failed to upload report file ${s3Path}: ${error.message}`);
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
    const contentType = mime.getType(remotePath) ?? 'application/octet-stream';

    const { error } = await withError(
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: remotePath,
          Body: fileStream,
          ContentType: contentType,
        })
      )
    );

    if (error) {
      console.error(`[s3] failed to upload file: ${error.message}, retrying in 3s...`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return await this.uploadFileWithRetry(remotePath, filePath, attempt + 1);
    }
  }

  private async clearTempFolders(id?: string) {
    await withError(fs.rm(path.join(TMP_FOLDER, id ?? ''), { recursive: true, force: true }));
  }

  async cleanupGeneratedReport(reportId: string): Promise<void> {
    await withError(fs.rm(path.join(REPORTS_FOLDER, reportId), { recursive: true, force: true }));
  }

  async generateReport(
    resultsIds: string[],
    metadata?: ReportUploadMetadata
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

    try {
      return await this.generateReportInner(reportId, resultsIds, tempFolder, metadata);
    } finally {
      await this.clearTempFolders(reportId);
    }
  }

  private async generateReportInner(
    reportId: UUID,
    resultsIds: string[],
    tempFolder: string,
    metadata?: ReportUploadMetadata
  ): Promise<{ reportId: UUID; reportPath: string; report: ReportHistory }> {
    for (const resultId of resultsIds) {
      const fileName = `${resultId}.zip`;

      // Reuse a local copy if one is already on disk to skip the round trip.
      // Only trust the cache once the result is registered in SQLite — that
      // happens after S3 upload completes, so this rules out partial copies
      // and stale files for results that have since been deleted.
      const temporaryPath = path.join(TMP_FOLDER, 'results', fileName);
      const isRegistered = !!resultDb.getByID(resultId);
      const { error: temporaryFileExistError } = isRegistered
        ? await withError(fs.access(temporaryPath))
        : { error: new Error('result not registered') };
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

        // Cache entry served its purpose — drop it now instead of waiting for the cron sweep.
        const { error: unlinkError } = await withError(fs.unlink(temporaryPath));
        if (unlinkError) {
          console.warn(`[s3] failed to clear cache entry for ${resultId}: ${unlinkError.message}`);
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

    const { reportPath } = await generatePlaywrightReport(reportId, metadata ?? {});

    const sizeBytes = await getFolderSize.loose(reportPath);
    console.log(`[s3] report ${reportId} generated (${bytesToString(sizeBytes)})`);

    const { result: info, error: parseReportMetadataError } = await withError(
      this.parseReportMetadata(reportId, reportPath, metadata, undefined, sizeBytes)
    );

    if (parseReportMetadataError) console.error(parseReportMetadataError.message);

    await this.uploadReportAtomic(reportPath, path.join(REPORTS_BUCKET, reportId));

    return {
      reportId,
      reportPath,
      report: (info ?? metadata ?? {}) as unknown as ReportHistory,
    };
  }

  /** Upload a generated report directory to S3 under a `.tmp/` prefix first,
   *  then "commit" by copying objects to the canonical prefix and deleting
   *  the temp objects. On failure, the temp prefix is purged so the bucket
   *  never carries half a report under the real reportId. */
  private async uploadReportAtomic(reportPath: string, remotePath: string): Promise<void> {
    const tmpPrefix = `${remotePath}.tmp`;
    const { error: uploadError } = await withError(this.uploadReport(reportPath, tmpPrefix));
    if (uploadError) {
      await withError(this.clearPrefix(tmpPrefix));
      throw new Error(`[s3] failed to upload report: ${uploadError.message}`);
    }
    const { error: commitError } = await withError(this.commitPrefix(tmpPrefix, remotePath));
    if (commitError) {
      await withError(this.clearPrefix(tmpPrefix));
      await withError(this.clearPrefix(remotePath));
      throw new Error(`[s3] failed to commit report: ${commitError.message}`);
    }
  }

  private async commitPrefix(srcPrefix: string, dstPrefix: string): Promise<void> {
    const srcObjects = await this.listObjectsUnderPrefix(srcPrefix);
    await processWithConcurrency(srcObjects, this.batchSize, async (srcKey) => {
      const dstKey = `${dstPrefix}${srcKey.slice(srcPrefix.length)}`;
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: encodeURIComponent(`${this.bucket}/${srcKey}`),
          Key: dstKey,
          ContentType: mime.getType(dstKey) ?? 'application/octet-stream',
          MetadataDirective: 'REPLACE',
        })
      );
    });
    await this.clearPrefix(srcPrefix);
  }

  private async clearPrefix(prefix: string): Promise<void> {
    const objects = await this.listObjectsUnderPrefix(prefix);
    await this.clear(...objects);
  }

  private async listObjectsUnderPrefix(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix.endsWith('/') ? prefix : `${prefix}/`,
          ContinuationToken: continuationToken,
        })
      );
      for (const obj of response.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key);
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return keys;
  }

  private async parseReportMetadata(
    reportId: string,
    reportPath: string,
    metadata?: ReportUploadMetadata,
    // Optionally provide the file's content directly (when it lives on S3, not on disk).
    htmlContent?: string,
    sizeBytes?: number
  ): Promise<ReportUploadMetadata> {
    const html = htmlContent ?? (await fs.readFile(path.join(reportPath, 'index.html'), 'utf-8'));

    const info = await parse(html as string);

    const content = Object.assign(
      info,
      {
        reportID: reportId,
        createdAt: info.startTime
          ? new Date(info.startTime).toISOString()
          : new Date().toISOString(),
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

  async uploadReportFromZipFile(
    reportId: string,
    zipFilePath: string,
    metadata?: ReportUploadMetadata
  ): Promise<{ reportPath: string; report: ReportHistory }> {
    const remotePath = path.join(REPORTS_BUCKET, reportId);

    const semaphore = new Semaphore(this.batchSize);
    const directory = await Open.file(zipFilePath);
    const fileEntries = directory.files
      .filter((file) => file.type === 'File')
      .map((file) => ({ file, safePath: safeZipEntryPath(file.path) }));
    const indexFile = fileEntries.find((entry) => entry.safePath === 'index.html');

    if (!indexFile) {
      throw new Error('index.html not found at root of uploaded report ZIP');
    }

    const uploadResults = await Promise.all(
      fileEntries.map(({ file, safePath }) =>
        semaphore.run(async () => {
          const s3Key = path.posix.join(remotePath, safePath);

          let entrySize = 0;
          const countingPassThrough = new PassThrough({
            transform(chunk, _encoding, callback) {
              entrySize += chunk.length;
              callback(null, chunk);
            },
          });

          file.stream().pipe(countingPassThrough);

          const uploadResult = await new Upload({
            client: this.client,
            params: {
              Bucket: this.bucket,
              Key: s3Key,
              Body: countingPassThrough,
              ContentType: mime.getType(s3Key) ?? 'application/octet-stream',
            },
          }).done();

          if (uploadResult instanceof Error) {
            throw uploadResult;
          }

          return { size: entrySize };
        })
      )
    );

    const totalSizeBytes = uploadResults.reduce((sum, { size }) => sum + size, 0);

    const htmlContent = (await indexFile.file.buffer()).toString('utf-8');
    const info = await this.parseReportMetadata(
      reportId,
      remotePath,
      metadata,
      htmlContent,
      totalSizeBytes
    );

    return { reportPath: remotePath, report: info as unknown as ReportHistory };
  }
}

import { randomUUID, type UUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import {
  BlobSASPermissions,
  BlobServiceClient,
  type ContainerClient,
  StorageSharedKeyCredential,
} from '@azure/storage-blob';
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

const createClient = (): {
  serviceClient: BlobServiceClient;
  credential: StorageSharedKeyCredential;
} => {
  const accountName = env.AZURE_ACCOUNT_NAME;
  const accountKey = env.AZURE_ACCOUNT_KEY;

  if (!accountName) {
    throw new Error('AZURE_ACCOUNT_NAME is required');
  }

  if (!accountKey) {
    throw new Error('AZURE_ACCOUNT_KEY is required');
  }

  console.log('[azure] creating client');

  const credential = new StorageSharedKeyCredential(accountName, accountKey);
  const serviceClient = new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    credential
  );

  return { serviceClient, credential };
};

export class AzureBlob implements Storage {
  private static instance: AzureBlob;
  private readonly container: ContainerClient;
  private readonly containerName: string;
  private readonly batchSize: number;

  private constructor() {
    const { serviceClient } = createClient();
    this.containerName = env.AZURE_CONTAINER;
    this.batchSize = env.AZURE_BATCH_SIZE;
    this.container = serviceClient.getContainerClient(this.containerName);
  }

  public static getInstance() {
    if (!AzureBlob.instance) {
      AzureBlob.instance = new AzureBlob();
    }

    return AzureBlob.instance;
  }

  private async ensureContainerExists() {
    const { error } = await withError(this.container.createIfNotExists());
    if (error) {
      console.error(`[azure] failed to ensure container exists: ${error.message}`);
    }
  }

  private async readStream(targetPath: string): Promise<ReadFileResult | null> {
    await this.ensureContainerExists();

    const remotePath = targetPath.includes(REPORTS_BUCKET)
      ? targetPath
      : `${REPORTS_BUCKET}/${targetPath}`;

    const blobClient = this.container.getBlobClient(remotePath);
    const { result: response, error } = await withError(blobClient.download());

    if (error || !response?.readableStreamBody) {
      if (error) console.error(`[azure] failed to read file ${targetPath}: ${error.message}`);
      return null;
    }

    return {
      body: response.readableStreamBody as unknown as Readable,
      size: typeof response.contentLength === 'number' ? response.contentLength : undefined,
    };
  }

  async clear(...paths: string[]) {
    await processWithConcurrency(paths, this.batchSize, async (blobPath) => {
      await this.container.getBlobClient(blobPath).deleteIfExists();
    });
  }

  // Azure blob keys must use forward slashes regardless of host OS, so the
  // remote key is built with `path.posix.join` while the local path uses the
  // platform separator. Leading slashes on the stored config path are stripped
  // so we don't produce an absolute path that escapes DATA_FOLDER.
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
      throw new Error(`[azure] branding asset not found locally: ${localPath}`);
    }

    console.log(`[azure] uploading branding asset: ${remoteKey}`);
    const { error } = await withError(this.uploadFileWithRetry(remoteKey, localPath));

    if (error) {
      throw new Error(`[azure] failed to upload branding asset ${remoteKey}: ${error.message}`);
    }
  }

  async ensureBrandingAsset(relativePath: string): Promise<void> {
    const { localPath, remoteKey } = this.resolveBrandingAsset(relativePath);

    const { error: missingLocally } = await withError(fs.access(localPath));
    if (!missingLocally) return;

    await fs.mkdir(path.dirname(localPath), { recursive: true });

    const blobClient = this.container.getBlobClient(remoteKey);
    const { error: downloadError } = await withError(blobClient.downloadToFile(localPath));

    if (downloadError) {
      console.warn(
        `[azure] branding asset not found remotely: ${remoteKey} (${downloadError.message})`
      );
      await withError(fs.unlink(localPath));
    }
  }

  async deleteBrandingAsset(relativePath: string): Promise<void> {
    const { remoteKey } = this.resolveBrandingAsset(relativePath);
    const { error } = await withError(this.clear(remoteKey));
    if (error) {
      console.warn(`[azure] failed to delete branding asset ${remoteKey}: ${error.message}`);
    }
  }

  async getFolderSize(
    folderPath: string
  ): Promise<{ size: number; resultCount: number; indexCount: number }> {
    let resultCount = 0;
    let indexCount = 0;
    let totalSize = 0;

    for await (const blob of this.container.listBlobsFlat({ prefix: folderPath })) {
      if (blob.name?.endsWith('.zip')) {
        resultCount += 1;
      }

      if (blob.name?.endsWith('index.html') && !blob.name.includes('/trace/index.html')) {
        indexCount += 1;
      }

      totalSize += blob.properties.contentLength ?? 0;
    }

    return { size: totalSize, resultCount, indexCount };
  }

  async getServerDataInfo(): Promise<ServerDataInfo> {
    await this.ensureContainerExists();

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
    const ids = new Set(reportsIDs);

    for await (const blob of this.container.listBlobsFlat({ prefix: REPORTS_BUCKET })) {
      if (!blob.name) continue;

      const reportID = path.basename(path.dirname(blob.name));

      if (ids.has(reportID)) {
        files.push(blob.name);
      }
    }

    return files;
  }

  async deleteReports(reports: ReportPath[]): Promise<void> {
    const ids = reports.map((r) => r.reportID);
    const objects = await this.getReportObjects(ids);

    await withError(this.clear(...objects));
  }

  async generatePresignedUploadUrl(fileName: string) {
    await this.ensureContainerExists();
    const blobPath = path.posix.join(RESULTS_BUCKET, fileName);
    const blockBlobClient = this.container.getBlockBlobClient(blobPath);

    const expiresOn = new Date();
    expiresOn.setSeconds(expiresOn.getSeconds() + 30 * 60); // 30 minutes

    return blockBlobClient.generateSasUrl({
      expiresOn,
      permissions: BlobSASPermissions.parse('w'),
    });
  }

  async saveResult(filename: string, stream: PassThrough): Promise<void> {
    await this.ensureContainerExists();

    const remotePath = path.posix.join(RESULTS_BUCKET, filename);
    const blockBlobClient = this.container.getBlockBlobClient(remotePath);

    await blockBlobClient.uploadStream(stream);

    console.log(`[azure] uploaded ${filename}`);
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
      const azurePath = path.posix.join(
        remotePath,
        relativeDir ? relativeDir.split(path.sep).join('/') : '',
        file.name
      );

      const { error } = await withError(
        this.uploadFileWithRetry(azurePath, path.join(file.parentPath, file.name))
      );

      if (error) {
        console.error(`[azure] failed to upload report file ${azurePath}: ${error.message}`);
        throw new Error(`[azure] failed to upload report file ${azurePath}: ${error.message}`);
      }
    });
  }

  private async uploadFileWithRetry(
    remotePath: string,
    filePath: string,
    attempt = 1
  ): Promise<void> {
    if (attempt > 3) {
      throw new Error(`[azure] failed to upload file after ${attempt} attempts: ${filePath}`);
    }

    const blockBlobClient = this.container.getBlockBlobClient(remotePath);
    const contentType = mime.getType(remotePath) ?? 'application/octet-stream';

    const { error } = await withError(
      blockBlobClient.uploadFile(filePath, {
        blobHTTPHeaders: { blobContentType: contentType },
      })
    );

    if (error) {
      console.error(`[azure] failed to upload file: ${error.message}, retrying in 3s...`);
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
    console.log(`[azure] generating report from ${resultsIds.length} result(s)`);
    const { error: mkdirReportsError } = await withError(
      fs.mkdir(REPORTS_FOLDER, { recursive: true })
    );

    if (mkdirReportsError) {
      console.error(`[azure] failed to create reports folder: ${mkdirReportsError.message}`);
    }

    const reportId = randomUUID();
    const tempFolder = path.join(TMP_FOLDER, reportId);

    const { error: mkdirTempError } = await withError(fs.mkdir(tempFolder, { recursive: true }));

    if (mkdirTempError) {
      console.error(`[azure] failed to create temporary folder: ${mkdirTempError.message}`);
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
      // happens after blob upload completes, so this rules out partial copies
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
            `[azure] failed to copy existing result file for ${resultId}: ${copyError.message}`
          );
          break;
        }

        const { error: unlinkError } = await withError(fs.unlink(temporaryPath));
        if (unlinkError) {
          console.warn(
            `[azure] failed to clear cache entry for ${resultId}: ${unlinkError.message}`
          );
        }

        continue;
      }

      const blobKey = path.posix.join(RESULTS_BUCKET, fileName);
      const localFilePath = path.join(tempFolder, fileName);

      const blobClient = this.container.getBlobClient(blobKey);
      const { error: downloadError } = await withError(blobClient.downloadToFile(localFilePath));

      if (downloadError) {
        console.error(`[azure] failed to download ${blobKey}: ${downloadError.message}`);
        throw new Error(`failed to download ${blobKey}: ${downloadError.message}`);
      }
    }

    const { reportPath } = await generatePlaywrightReport(reportId, metadata ?? {});

    const sizeBytes = await getFolderSize.loose(reportPath);
    console.log(`[azure] report ${reportId} generated (${bytesToString(sizeBytes)})`);

    const { result: info, error: parseReportMetadataError } = await withError(
      this.parseReportMetadata(reportId, reportPath, metadata, undefined, sizeBytes)
    );

    if (parseReportMetadataError) console.error(parseReportMetadataError.message);

    await this.uploadReportAtomic(reportPath, path.posix.join(REPORTS_BUCKET, reportId));

    return {
      reportId,
      reportPath,
      report: (info ?? metadata ?? {}) as unknown as ReportHistory,
    };
  }

  /** Upload a generated report directory under a `.tmp` prefix first, then
   *  server-side copy to the canonical prefix. On failure, the tmp prefix
   *  is purged so the container never carries half a report under the real
   *  reportId. */
  private async uploadReportAtomic(reportPath: string, remotePath: string): Promise<void> {
    const tmpPrefix = `${remotePath}.tmp`;
    const { error: uploadError } = await withError(this.uploadReport(reportPath, tmpPrefix));
    if (uploadError) {
      await withError(this.clearPrefix(tmpPrefix));
      throw new Error(`[azure] failed to upload report: ${uploadError.message}`);
    }
    const { error: commitError } = await withError(this.commitPrefix(tmpPrefix, remotePath));
    if (commitError) {
      await withError(this.clearPrefix(tmpPrefix));
      await withError(this.clearPrefix(remotePath));
      throw new Error(`[azure] failed to commit report: ${commitError.message}`);
    }
  }

  private async commitPrefix(srcPrefix: string, dstPrefix: string): Promise<void> {
    const srcBlobs = await this.listBlobsUnderPrefix(srcPrefix);
    await processWithConcurrency(srcBlobs, this.batchSize, async (srcKey) => {
      const dstKey = `${dstPrefix}${srcKey.slice(srcPrefix.length)}`;
      const srcUrl = this.container.getBlobClient(srcKey).url;
      await this.container.getBlobClient(dstKey).syncCopyFromURL(srcUrl);
    });
    await this.clearPrefix(srcPrefix);
  }

  private async clearPrefix(prefix: string): Promise<void> {
    const keys = await this.listBlobsUnderPrefix(prefix);
    await this.clear(...keys);
  }

  private async listBlobsUnderPrefix(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    for await (const blob of this.container.listBlobsFlat({ prefix: normalized })) {
      keys.push(blob.name);
    }
    return keys;
  }

  private async parseReportMetadata(
    reportId: string,
    reportPath: string,
    metadata?: ReportUploadMetadata,
    // Optionally provide the file's content directly (when it lives on Azure, not on disk).
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
    await this.ensureContainerExists();

    const remotePath = path.posix.join(REPORTS_BUCKET, reportId);

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
          const blobKey = path.posix.join(remotePath, safePath);

          let entrySize = 0;
          const countingPassThrough = new PassThrough({
            transform(chunk, _encoding, callback) {
              entrySize += chunk.length;
              callback(null, chunk);
            },
          });

          file.stream().pipe(countingPassThrough);

          const blockBlobClient = this.container.getBlockBlobClient(blobKey);
          await blockBlobClient.uploadStream(countingPassThrough, undefined, undefined, {
            blobHTTPHeaders: {
              blobContentType: mime.getType(blobKey) ?? 'application/octet-stream',
            },
          });

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

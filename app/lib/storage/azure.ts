import { randomUUID, type UUID } from 'crypto';
import fs from 'fs/promises';
import path, { posix as posixPath } from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import {
  BlobServiceClient,
  BlobSASPermissions,
  StorageSharedKeyCredential,
  ContainerClient,
} from '@azure/storage-blob';

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

const getTimestamp = (date?: Date | string) => {
  if (!date) return 0;
  if (typeof date === 'string') return new Date(date).getTime();

  return date.getTime();
};

const createClient = (): { serviceClient: BlobServiceClient; credential: StorageSharedKeyCredential } => {
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
  const serviceClient = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, credential);

  return { serviceClient, credential };
};

export class AzureBlob implements Storage {
  private static instance: AzureBlob;
  private readonly container: ContainerClient;
  private readonly credential: StorageSharedKeyCredential;
  private readonly containerName: string;
  private readonly batchSize: number;

  private constructor() {
    const { serviceClient, credential } = createClient();
    this.containerName = env.AZURE_CONTAINER;
    this.batchSize = env.AZURE_BATCH_SIZE;
    this.container = serviceClient.getContainerClient(this.containerName);
    this.credential = credential;
  }

  public static getInstance() {
    if (!AzureBlob.instance) {
      AzureBlob.instance = new AzureBlob();
    }

    return AzureBlob.instance;
  }

  private async ensureContainerExists() {
    await this.container.createIfNotExists();
  }

  private async write(dir: string, files: { name: string; content: Readable | Buffer | string; size?: number }[]) {
    await this.ensureContainerExists();

    await Promise.all(
      files.map(async (file) => {
        const blobPath = posixPath.join(dir, file.name);

        console.log(`[azure] writing ${blobPath}`);

        const blockBlobClient = this.container.getBlockBlobClient(blobPath);

        if (typeof file.content === 'string') {
          const buffer = Buffer.from(file.content);

          await blockBlobClient.upload(buffer, buffer.length);
        } else if (Buffer.isBuffer(file.content)) {
          await blockBlobClient.upload(file.content, file.content.length);
        } else {
          await blockBlobClient.uploadStream(file.content);
        }
      }),
    );
  }

  private async read(targetPath: string, contentType?: string | null) {
    await this.ensureContainerExists();
    console.log(`[azure] read ${targetPath}`);

    const remotePath = targetPath.includes(REPORTS_BUCKET) ? targetPath : `${REPORTS_BUCKET}/${targetPath}`;

    console.log(`[azure] reading from remote path: ${remotePath}`);

    const blobClient = this.container.getBlobClient(remotePath);
    const { result: downloadResponse, error } = await withError(blobClient.download());

    if (error ?? !downloadResponse?.readableStreamBody) {
      return { result: null, error };
    }

    const readStream = new Promise<Buffer>((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      const stream = downloadResponse.readableStreamBody!;

      stream.on('data', (chunk: Uint8Array) => {
        chunks.push(chunk);
      });

      stream.on('end', () => {
        resolve(Buffer.concat(chunks));
      });

      stream.on('error', (err: Error) => {
        console.error(`[azure] failed to read stream: ${err.message}`);
        reject(err);
      });
    });

    const { result, error: readError } = await withError(readStream);

    return {
      result: contentType === 'text/html' ? result?.toString('utf-8') : result,
      error: error ?? readError ?? null,
    };
  }

  async clear(...paths: string[]) {
    console.log(`[azure] clearing ${paths}`);
    await processBatch<string, void>(this, paths, this.batchSize, async (blobPath) => {
      await this.container.getBlobClient(blobPath).deleteIfExists();
    });
  }

  async getFolderSize(folderPath: string): Promise<{ size: number; resultCount: number; indexCount: number }> {
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
    console.log('[azure] getting server data');

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
    console.log(`[azure] reading ${targetPath} | ${contentType}`);
    const { result, error } = await this.read(targetPath, contentType);

    if (error) {
      console.error(`[azure] failed to read file ${targetPath}: ${error.message}`);
      throw new Error(`[azure] failed to read file: ${error.message}`);
    }

    return result!;
  }

  async readResults(input?: ReadResultsInput): Promise<ReadResultsOutput> {
    await this.ensureContainerExists();
    console.log('[azure] reading results');

    const jsonFiles: { name: string; lastModified?: Date }[] = [];
    const resultSizes = new Map<string, number>();

    for await (const blob of this.container.listBlobsFlat({ prefix: RESULTS_BUCKET })) {
      if (!blob.name) continue;

      if (blob.name.endsWith('.zip')) {
        const resultID = path.basename(blob.name, '.zip');

        resultSizes.set(resultID, blob.properties.contentLength ?? 0);
      }

      if (!blob.name.endsWith('.json')) continue;

      jsonFiles.push({ name: blob.name, lastModified: blob.properties.lastModified });
    }

    console.log(`[azure] found ${jsonFiles.length} json files`);

    if (!jsonFiles.length) {
      return { results: [], total: 0 };
    }

    jsonFiles.sort((a, b) => getTimestamp(b.lastModified) - getTimestamp(a.lastModified));

    const noFilters = !input?.project && !input?.pagination;
    const resultFiles = noFilters ? handlePagination(jsonFiles, input?.pagination) : jsonFiles;

    const results = await processBatch<{ name: string }, Result>(this, resultFiles, this.batchSize, async (file) => {
      console.log(`[azure.batch] reading result: ${file.name}`);
      const blobClient = this.container.getBlobClient(file.name);
      const downloadResponse = await blobClient.download();

      const chunks: Uint8Array[] = [];

      for await (const chunk of downloadResponse.readableStreamBody ?? []) {
        chunks.push(chunk as Uint8Array);
      }

      return JSON.parse(Buffer.concat(chunks).toString());
    });

    const notMetadataKeys = ['resultID', 'title', 'createdAt', 'size', 'sizeBytes', 'project'];

    let filteredResults = results.filter((file) => (input?.project ? file.project === input.project : file));

    if (input?.tags && input.tags.length > 0) {
      filteredResults = filteredResults.filter((result) => {
        const resultTags = Object.entries(result)
          .filter(([key]) => !notMetadataKeys.includes(key))
          .map(([key, value]) => `${key}: ${value}`);

        return input.tags!.some((selectedTag) => resultTags.includes(selectedTag));
      });
    }

    if (input?.search?.trim()) {
      const searchTerm = input.search.toLowerCase().trim();

      filteredResults = filteredResults.filter((result) => {
        const searchableFields = [
          result.title,
          result.resultID,
          result.project,
          ...Object.entries(result)
            .filter(([key]) => !notMetadataKeys.includes(key))
            .map(([key, value]) => `${key}: ${value}`),
        ].filter(Boolean);

        return searchableFields.some((field) => field?.toLowerCase().includes(searchTerm));
      });
    }

    if (input?.dateFrom || input?.dateTo) {
      const fromTimestamp = input.dateFrom ? getTimestamp(input.dateFrom) : 0;
      const toTimestamp = input.dateTo ? getTimestamp(input.dateTo) : Number.MAX_SAFE_INTEGER;

      filteredResults = filteredResults.filter((result) => {
        const resultTimestamp = getTimestamp(result.createdAt);

        return resultTimestamp >= fromTimestamp && resultTimestamp <= toTimestamp;
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
    await this.ensureContainerExists();
    console.log('[azure] reading reports from external storage');

    const reports: Report[] = [];
    const reportSizes = new Map<string, number>();

    for await (const blob of this.container.listBlobsFlat({ prefix: REPORTS_BUCKET })) {
      if (!blob.name) continue;

      const reportID = getFileReportID(blob.name);
      const newSize = (reportSizes.get(reportID) ?? 0) + (blob.properties.contentLength ?? 0);

      reportSizes.set(reportID, newSize);

      if (!blob.name.endsWith('index.html') || blob.name.includes('trace')) continue;

      const dir = posixPath.dirname(blob.name);
      const id = posixPath.basename(dir);
      const parentDir = posixPath.basename(posixPath.dirname(dir));

      const projectName = parentDir === REPORTS_PATH ? '' : parentDir;

      const noFilters = !input?.project && !input?.ids;
      const shouldFilterByProject = input?.project && projectName === input.project;
      const shouldFilterByID = input?.ids?.includes(id);

      const report = {
        reportID: id,
        project: projectName,
        createdAt: blob.properties.lastModified,
        reportUrl: `${serveReportRoute}/${projectName ? encodeURIComponent(projectName) : ''}/${id}/index.html`,
        size: '',
        sizeBytes: 0,
      };

      if (noFilters || shouldFilterByProject || shouldFilterByID) {
        reports.push(report);
      }
    }

    reports.sort((a, b) => getTimestamp(b.createdAt) - getTimestamp(a.createdAt));

    const currentReports = handlePagination<Report>(reports, input?.pagination);
    const withMetadata = await this.getReportsMetadata(currentReports as ReportHistory[]);

    let filteredReports = withMetadata;

    if (input?.search && input.search.trim()) {
      const searchTerm = input.search.toLowerCase().trim();

      filteredReports = filteredReports.filter((report) => {
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

    if (input?.dateFrom || input?.dateTo) {
      const fromTimestamp = input.dateFrom ? getTimestamp(input.dateFrom) : 0;
      const toTimestamp = input.dateTo ? getTimestamp(input.dateTo) : Number.MAX_SAFE_INTEGER;

      filteredReports = filteredReports.filter((report) => {
        const reportTimestamp = getTimestamp(report.createdAt);

        return reportTimestamp >= fromTimestamp && reportTimestamp <= toTimestamp;
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
      console.log(`[azure.batch] reading report ${report.reportID} metadata`);

      const { result: metadata, error: metadataError } = await withError(
        this.readOrParseReportMetadata(report.reportID, report.project),
      );

      if (metadataError) {
        console.error(`[azure] failed to read or create metadata for ${report.reportID}: ${metadataError.message}`);

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
      this.readFile(posixPath.join(REPORTS_BUCKET, projectName, id, REPORT_METADATA_FILE), 'utf-8'),
    );

    if (metadataError) console.error(`[azure] failed to read metadata for ${id}: ${metadataError.message}`);

    const metadata = metadataContent && !metadataError ? JSON.parse(metadataContent.toString()) : {};

    if (isReportHistory(metadata)) {
      console.log(`metadata found for report ${id}`);

      return metadata;
    }

    console.log(`metadata file not found for ${id}, creating new metadata`);
    try {
      const { result: htmlContent, error: htmlError } = await withError(
        this.readFile(posixPath.join(REPORTS_BUCKET, projectName, id, 'index.html'), 'utf-8'),
      );

      if (htmlError) console.error(`[azure] failed to read index.html for ${id}: ${htmlError.message}`);

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

  private async getReportObjects(reportIDs: string[]): Promise<string[]> {
    const files: string[] = [];
    const reportIDSet = new Set(reportIDs);

    for await (const blob of this.container.listBlobsFlat({ prefix: REPORTS_BUCKET })) {
      if (!blob.name) continue;

      const reportID = posixPath.basename(posixPath.dirname(blob.name));

      if (reportIDSet.has(reportID)) {
        files.push(blob.name);
      }
    }

    return files;
  }

  async deleteReports(reportIDs: string[]): Promise<void> {
    const objects = await this.getReportObjects(reportIDs);

    await withError(this.clear(...objects));
  }

  async generatePresignedUploadUrl(fileName: string) {
    await this.ensureContainerExists();
    const blobPath = posixPath.join(RESULTS_BUCKET, fileName);
    const blockBlobClient = this.container.getBlockBlobClient(blobPath);

    const expiresOn = new Date();

    expiresOn.setSeconds(expiresOn.getSeconds() + 30 * 60); // 30 minutes

    return blockBlobClient.generateSasUrl({
      expiresOn,
      permissions: BlobSASPermissions.parse('w'),
    });
  }

  async saveResult(filename: string, stream: PassThrough) {
    return await this.write(RESULTS_BUCKET, [
      {
        name: filename,
        content: stream,
      },
    ]);
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
    console.log(`[azure] upload report: ${reportPath}`);

    const files = await fs.readdir(reportPath, { recursive: true, withFileTypes: true });

    await processBatch(this, files, this.batchSize, async (file) => {
      if (!file.isFile()) {
        return;
      }

      console.log(`[azure] uploading file: ${JSON.stringify(file)}`);

      const nestedPath = (file as any).path.split(reportId).pop();
      const azurePath = posixPath.join(remotePath, nestedPath ?? '', file.name);

      console.log(`[azure] uploading to ${azurePath}`);

      const { error } = await withError(this.uploadFileWithRetry(azurePath, path.join((file as any).path, file.name)));

      if (error) {
        console.error(`[azure] failed to upload report: ${error.message}`);
        throw new Error(`[azure] failed to upload report: ${error.message}`);
      }
    });
  }

  private async uploadFileWithRetry(remotePath: string, filePath: string, attempt = 1): Promise<void> {
    if (attempt > 3) {
      throw new Error(`[azure] failed to upload file after ${attempt} attempts: ${filePath}`);
    }

    const blockBlobClient = this.container.getBlockBlobClient(remotePath);
    const { error } = await withError(blockBlobClient.uploadFile(filePath));

    if (error) {
      console.error(`[azure] failed to upload file: ${error.message}`);
      console.log(`[azure] will retry in 3s...`);
      await new Promise((resolve) => setTimeout(resolve, 3000));

      return await this.uploadFileWithRetry(remotePath, filePath, attempt + 1);
    }
  }

  private async clearTempFolders(id?: string) {
    const withReportPathMaybe = id ? ` for report ${id}` : '';

    console.log(`[azure] clear temp folders${withReportPathMaybe}`);

    await Promise.all([
      withError(fs.rm(path.join(TMP_FOLDER, id ?? ''), { recursive: true, force: true })),
      withError(fs.rm(REPORTS_FOLDER, { recursive: true, force: true })),
    ]);
  }

  async generateReport(resultsIds: string[], metadata?: ReportMetadata): Promise<UUID> {
    console.log(`[azure] generate report from results: ${JSON.stringify(resultsIds)}`);
    console.log(`[azure] create temp folders`);

    const { error: mkdirReportsError } = await withError(fs.mkdir(REPORTS_FOLDER, { recursive: true }));

    if (mkdirReportsError) {
      console.error(`[azure] failed to create reports folder: ${mkdirReportsError.message}`);
    }

    const reportId = randomUUID();
    const tempFolder = path.join(TMP_FOLDER, reportId);

    const { error: mkdirTempError } = await withError(fs.mkdir(tempFolder, { recursive: true }));

    if (mkdirTempError) {
      console.error(`[azure] failed to create temporary folder: ${mkdirTempError.message}`);
    }

    console.log(`[azure] start processing...`);

    const resultsIdSet = new Set(resultsIds);
    const blobsToDownload: { blobName: string; localFilePath: string }[] = [];

    for await (const blob of this.container.listBlobsFlat({ prefix: RESULTS_BUCKET })) {
      const fileName = path.basename(blob.name);
      const id = fileName.replace(path.extname(fileName), '');

      if (resultsIdSet.has(id)) {
        blobsToDownload.push({ blobName: blob.name, localFilePath: path.join(tempFolder, fileName) });
      }
    }

    await processBatch(this, blobsToDownload, this.batchSize, async ({ blobName, localFilePath }) => {
      console.log(`[azure] downloading ${blobName}...`);
      const blobClient = this.container.getBlobClient(blobName);
      const { error } = await withError(blobClient.downloadToFile(localFilePath));

      if (error) {
        console.error(`[azure] failed to download ${blobName}: ${error.message}`);
        throw new Error(`failed to download ${blobName}: ${error.message}`);
      }

      console.log(`[azure] Downloaded: ${blobName} to ${localFilePath}`);
    });

    const { reportPath } = await generatePlaywrightReport(reportId, metadata!);

    console.log(`[azure] report generated: ${reportId} | ${reportPath}`);

    const { result: info, error: parseReportMetadataError } = await withError(
      this.parseReportMetadata(reportId, reportPath, metadata),
    );

    if (parseReportMetadataError) console.error(parseReportMetadataError.message);

    const remotePath = posixPath.join(REPORTS_BUCKET, metadata?.project ?? '', reportId);

    const { error: uploadError } = await withError(this.uploadReport(reportId, reportPath, remotePath));

    if (uploadError) {
      console.error(`[azure] failed to upload report: ${uploadError.message}`);
    } else {
      const { error } = await withError(this.saveReportMetadata(reportId, reportPath, info ?? metadata ?? {}));

      if (error) console.error(`[azure] failed to save report metadata: ${error.message}`);
    }

    await this.clearTempFolders(reportId);

    return reportId;
  }

  private async saveReportMetadata(reportId: string, reportPath: string, metadata: ReportMetadata) {
    console.log(`[azure] report uploaded: ${reportId}, uploading metadata to ${reportPath}`);
    const { error: metadataError } = await withError(
      this.write(posixPath.join(REPORTS_BUCKET, metadata.project ?? '', reportId), [
        {
          name: REPORT_METADATA_FILE,
          content: JSON.stringify(metadata),
        },
      ]),
    );

    if (metadataError) console.error(`[azure] failed to upload report metadata: ${metadataError.message}`);
  }

  private async parseReportMetadata(
    reportId: string,
    reportPath: string,
    metadata?: Record<string, string>,
    htmlContent?: string,
  ): Promise<ReportMetadata> {
    console.log(`[azure] creating report metadata for ${reportId} and ${reportPath}`);
    const html = htmlContent ?? (await fs.readFile(path.join(reportPath, 'index.html'), 'utf-8'));

    const info = await parse(html as string);

    const content = Object.assign(info, metadata, {
      reportId,
      createdAt: new Date().toISOString(),
    });

    return content;
  }

  async readConfigFile(): Promise<{ result?: SiteWhiteLabelConfig; error: Error | null }> {
    await this.ensureContainerExists();
    console.log(`[azure] checking config file`);

    const blobClient = this.container.getBlobClient(APP_CONFIG_S3);
    const { result: downloadResponse, error } = await withError(blobClient.download());

    if (error) {
      console.error(`[azure] failed to read config file: ${error.message}`);

      return { error };
    }

    const configChunks: Uint8Array[] = [];

    for await (const chunk of downloadResponse?.readableStreamBody ?? []) {
      configChunks.push(chunk as Uint8Array);
    }

    const existingConfig = Buffer.concat(configChunks).toString();

    try {
      const parsed = JSON.parse(existingConfig);
      const isValid = isConfigValid(parsed);

      if (!isValid) {
        return { error: new Error('invalid config') };
      }

      for (const image of [
        { path: parsed.faviconPath, default: defaultConfig.faviconPath },
        { path: parsed.logoPath, default: defaultConfig.logoPath },
      ]) {
        if (!image) continue;
        if (image.path === image.default) continue;

        const localPath = path.join(DATA_FOLDER, image.path);
        const { error: accessError } = await withError(fs.access(localPath));

        if (accessError) {
          const remotePath = posixPath.join(DATA_PATH, image.path);

          console.log(`[azure] downloading config image: ${remotePath} to ${localPath}`);
          await this.container.getBlobClient(remotePath).downloadToFile(localPath);
        }
      }

      return { result: parsed, error: null };
    } catch (e) {
      return { error: new Error(`failed to parse config: ${e instanceof Error ? e.message : e}`) };
    }
  }

  async saveConfigFile(config: Partial<SiteWhiteLabelConfig>) {
    console.log(`[azure] writing config file`);

    const { result: existingConfig, error: readExistingConfigError } = await this.readConfigFile();

    if (readExistingConfigError) {
      console.error(`[azure] failed to read existing config file: ${readExistingConfigError.message}`);
    }

    const { error: clearExistingConfigError } = await withError(this.clear(APP_CONFIG_S3));

    if (clearExistingConfigError) {
      console.error(`[azure] failed to clear existing config file: ${clearExistingConfigError.message}`);
    }

    const uploadConfig = { ...(existingConfig ?? {}), ...config } as SiteWhiteLabelConfig;

    const isDefaultImage = (key: keyof SiteWhiteLabelConfig) => config[key] && config[key] === defaultConfig[key];

    const shouldBeUploaded = async (key: keyof SiteWhiteLabelConfig) => {
      if (!config[key]) return false;
      if (isDefaultImage(key)) return false;

      const blobClient = this.container.getBlobClient(uploadConfig[key] as string);
      const { result: exists } = await withError(blobClient.exists());

      return !exists;
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

    if (error) console.error(`[azure] failed to write config file: ${error.message}`);

    return { result: uploadConfig, error };
  }

  private async uploadConfigImage(imagePath: string): Promise<Error | null> {
    console.log(`[azure] uploading config image: ${imagePath}`);

    const localPath = path.join(DATA_FOLDER, imagePath);
    const remotePath = posixPath.join(DATA_PATH, imagePath);

    const { error } = await withError(this.uploadFileWithRetry(remotePath, localPath));

    if (error) {
      console.error(`[azure] failed to upload config image: ${error.message}`);

      return error;
    }

    return null;
  }
}

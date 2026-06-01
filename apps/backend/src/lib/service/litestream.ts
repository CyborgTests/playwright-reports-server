import { type ChildProcess, exec, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { env } from '../../config/env.js';
import { withError } from '../withError.js';

const PREFLIGHT_KEY = 'litestream/.preflight-canary';

const litestreamProcess = Symbol.for('playwright.reports.litestream');
const instance = globalThis as typeof globalThis & {
  [litestreamProcess]?: LitestreamService;
};

/**
 * Service to manage Litestream process for SQLite replication to S3 or Azure Blob.
 * @link https://litestream.io/
 */
export class LitestreamService {
  private process: ChildProcess | null = null;
  private configPath: string;
  private readonly dbPath: string;

  private constructor() {
    this.dbPath = path.join(process.cwd(), 'data', 'metadata.db');
    this.configPath = path.join(os.tmpdir(), 'litestream.yml');
  }

  private get usesS3() {
    return env.DATA_STORAGE === 's3';
  }

  private get usesAzure() {
    return env.DATA_STORAGE === 'azure';
  }

  private get usesObjectStorage() {
    return this.usesS3 || this.usesAzure;
  }

  private generateConfig(): string {
    const absoluteDbPath = path.resolve(this.dbPath);
    const y = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

    let comment: string;
    let replicaLines: string[];

    if (this.usesAzure) {
      const accountName = env.AZURE_ACCOUNT_NAME;
      const accountKey = env.AZURE_ACCOUNT_KEY;
      const container = env.AZURE_CONTAINER;

      if (!accountName || !accountKey || !container) {
        throw new Error(
          'Missing required Azure configuration for Litestream: AZURE_ACCOUNT_NAME, AZURE_ACCOUNT_KEY, AZURE_CONTAINER'
        );
      }

      comment = '# Litestream configuration for SQLite replication to Azure Blob Storage';
      replicaLines = [
        `      - url: ${y(`abs://${accountName}@${container}/litestream/metadata.db`)}`,
        `        account-key: ${y(accountKey)}`,
        '        sync-interval: 1s',
        '        snapshot-interval: 3h',
        '        retention: 24h',
        '        retention-check-interval: 1h',
      ];
    } else {
      const s3Path = 'litestream';
      const bucket = env.S3_BUCKET;
      const region = env.S3_REGION || 'us-east-1';
      const endpoint = env.S3_ENDPOINT;
      const port = env.S3_PORT;
      const accessKeyId = env.S3_ACCESS_KEY;
      const secretAccessKey = env.S3_SECRET_KEY;

      if (!bucket || !accessKeyId || !secretAccessKey) {
        throw new Error(
          'Missing required S3 configuration for Litestream: S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY'
        );
      }

      const protocol = endpoint?.startsWith('http') ? '' : env.S3_USE_SSL ? 'https://' : 'http://';
      const endpointUrl = endpoint
        ? port
          ? `${protocol}${endpoint}:${port}`
          : `${protocol}${endpoint}`
        : '';

      comment = '# Litestream configuration for SQLite replication to S3';
      replicaLines = [
        `      - url: ${y(`s3://${bucket}/${s3Path}/metadata.db`)}`,
        `        access-key-id: ${y(accessKeyId)}`,
        `        secret-access-key: ${y(secretAccessKey)}`,
        `        region: ${y(region)}`,
      ];
      if (endpointUrl) {
        replicaLines.push(`        endpoint: ${y(endpointUrl)}`);
      }
      replicaLines.push(
        '        force-path-style: true',
        '        sync-interval: 1s',
        '        snapshot-interval: 3h',
        '        retention: 24h',
        '        retention-check-interval: 1h'
      );
    }

    return `${comment}
# See: https://litestream.io/reference/config/
dbs:
  - path: ${y(absoluteDbPath)}
    replicas:
${replicaLines.join('\n')}
`;
  }

  private async ensureConfigExists(): Promise<void> {
    const config = this.generateConfig();
    await fs.writeFile(this.configPath, config, 'utf-8');
  }

  public static getInstance(): LitestreamService {
    instance[litestreamProcess] ??= new LitestreamService();
    return instance[litestreamProcess];
  }

  /**
   * Verifies object-storage credentials and required permissions before
   * Litestream is started. Performs a Put → Get → Delete roundtrip on a canary
   * key under the litestream/ prefix, asserting body equality to catch
   * endpoint/bucket/container misroutes. Throws on any failure so the app fails
   * fast at boot.
   */
  public async preflight(): Promise<void> {
    if (this.usesAzure) {
      await this.preflightAzure();
      return;
    }
    if (this.usesS3) {
      await this.preflightS3();
    }
  }

  /**
   * Required IAM: s3:PutObject, s3:GetObject, s3:DeleteObject on the bucket.
   */
  private async preflightS3(): Promise<void> {
    const endpoint = env.S3_ENDPOINT;
    const accessKey = env.S3_ACCESS_KEY;
    const secretKey = env.S3_SECRET_KEY;
    const bucket = env.S3_BUCKET;

    if (!endpoint || !accessKey || !secretKey || !bucket) {
      throw new Error(
        '[litestream] preflight failed: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET are required when DATA_STORAGE=s3'
      );
    }

    const protocol = env.S3_USE_SSL ? 'https://' : 'http://';
    const endpointUrl = env.S3_PORT
      ? `${protocol}${endpoint}:${env.S3_PORT}`
      : `${protocol}${endpoint}`;

    const client = new S3Client({
      region: env.S3_REGION || 'us-east-1',
      endpoint: endpointUrl,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      forcePathStyle: true,
    });

    const expected = `${process.pid}:${Date.now()}`;
    const target = `s3://${bucket}/${PREFLIGHT_KEY}`;
    console.log(`[litestream] preflight: roundtrip against ${target}`);

    try {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: PREFLIGHT_KEY, Body: expected })
      );

      const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: PREFLIGHT_KEY }));
      const actual = (await got.Body?.transformToString()) ?? '';
      if (actual !== expected) {
        throw new Error(`canary roundtrip mismatch: wrote "${expected}", read "${actual}"`);
      }

      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: PREFLIGHT_KEY }));
    } catch (error) {
      const err = error as { name?: string; message?: string };
      const code = err.name ?? 'UnknownError';
      throw new Error(
        `[litestream] preflight failed (${code}) on ${target}: ${err.message ?? String(error)}. ` +
          'Ensure credentials are valid and have s3:PutObject, s3:GetObject, and s3:DeleteObject on the bucket.'
      );
    } finally {
      client.destroy();
    }

    console.log(`[litestream] preflight OK: read/write/delete verified on s3://${bucket}`);
  }

  /**
   * Required permissions: read/write/delete on the configured container.
   */
  private async preflightAzure(): Promise<void> {
    const accountName = env.AZURE_ACCOUNT_NAME;
    const accountKey = env.AZURE_ACCOUNT_KEY;
    const container = env.AZURE_CONTAINER;

    if (!accountName || !accountKey || !container) {
      throw new Error(
        '[litestream] preflight failed: AZURE_ACCOUNT_NAME, AZURE_ACCOUNT_KEY, and AZURE_CONTAINER are required when DATA_STORAGE=azure'
      );
    }

    const credential = new StorageSharedKeyCredential(accountName, accountKey);
    const serviceClient = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      credential
    );
    const containerClient = serviceClient.getContainerClient(container);
    const blobClient = containerClient.getBlockBlobClient(PREFLIGHT_KEY);

    const expected = `${process.pid}:${Date.now()}`;
    const target = `abs://${accountName}@${container}/${PREFLIGHT_KEY}`;
    console.log(`[litestream] preflight: roundtrip against ${target}`);

    try {
      await blobClient.upload(expected, Buffer.byteLength(expected));
      const buffer = await blobClient.downloadToBuffer();
      const actual = buffer.toString('utf-8');
      if (actual !== expected) {
        throw new Error(`canary roundtrip mismatch: wrote "${expected}", read "${actual}"`);
      }
      await blobClient.delete();
    } catch (error) {
      const err = error as { name?: string; message?: string };
      const code = err.name ?? 'UnknownError';
      throw new Error(
        `[litestream] preflight failed (${code}) on ${target}: ${err.message ?? String(error)}. ` +
          'Ensure AZURE_ACCOUNT_NAME/AZURE_ACCOUNT_KEY are valid and have read/write/delete on the container.'
      );
    }

    console.log(
      `[litestream] preflight OK: read/write/delete verified on abs://${accountName}@${container}`
    );
  }

  public async restoreIfNeeded(): Promise<boolean> {
    if (!this.usesObjectStorage) {
      return false;
    }

    await this.ensureConfigExists();
    const dbExists = await this.databaseExists();

    if (!dbExists) {
      console.log('[litestream] No local sqlite found, attempting restore from remote...');
      const restored = await this.restoreFromRemote();
      if (restored) {
        console.log('[litestream] Successfully restored sqlite from remote');
      } else {
        console.log('[litestream] No sqlite found on remote, will start fresh');
      }
      return restored;
    }

    console.log('[litestream] Local sqlite exists, checking if remote is newer...');
    const hasRemote = await this.hasRemoteBackup();

    if (!hasRemote) {
      console.log('[litestream] No remote backup found, using local copy');
      return false;
    }

    console.log('[litestream] Remote backup exists, syncing with remote...');
    const synced = await this.syncWithRemote();

    if (synced) {
      console.log('[litestream] Successfully synced with remote backup');
    } else {
      console.log('[litestream] Sync failed, continuing with local copy');
    }

    return synced;
  }

  private async databaseExists(): Promise<boolean> {
    try {
      await fs.access(this.dbPath);
      return true;
    } catch {
      return false;
    }
  }

  private get cliDbArg(): string {
    return `"${path.resolve(this.dbPath)}"`;
  }

  private get cliConfigArg(): string {
    return `"${this.configPath}"`;
  }

  private async hasRemoteBackup(): Promise<boolean> {
    const litestreamEnv = this.buildLitestreamEnv();

    return new Promise((resolve) => {
      exec(
        `litestream generations -config ${this.cliConfigArg} ${this.cliDbArg}`,
        { env: litestreamEnv, timeout: 30000 },
        (error, stdout) => {
          if (error) {
            console.error('[litestream] Failed to check remote generations:', error.message);
            resolve(false);
          } else {
            const hasGenerations = stdout.trim().length > 0;
            resolve(hasGenerations);
          }
        }
      );
    });
  }

  private async syncWithRemote(): Promise<boolean> {
    const litestreamEnv = this.buildLitestreamEnv();

    return new Promise((resolve) => {
      exec(
        `litestream restore -config ${this.cliConfigArg} -o "${this.dbPath}" --if-replica-exists ${this.cliDbArg}`,
        { env: litestreamEnv, timeout: 60000 },
        (error) => {
          if (error) {
            console.error('[litestream] Sync with remote failed:', error.message);
            resolve(false);
          } else {
            resolve(true);
          }
        }
      );
    });
  }

  private async restoreFromRemote(): Promise<boolean> {
    const litestreamEnv = this.buildLitestreamEnv();

    return new Promise((resolve) => {
      exec(
        `litestream restore -config ${this.cliConfigArg} -o "${this.dbPath}" ${this.cliDbArg}`,
        { env: litestreamEnv, timeout: 60000 },
        (error) => {
          if (error) {
            console.error('[litestream] Restore failed:', error.message);
            resolve(false);
          } else {
            resolve(true);
          }
        }
      );
    });
  }

  private buildLitestreamEnv() {
    return { ...process.env };
  }

  private describeTarget(): string {
    if (this.usesAzure) {
      return `azure container=${env.AZURE_CONTAINER} account=${env.AZURE_ACCOUNT_NAME}`;
    }
    return `bucket=${env.S3_BUCKET} endpoint=${env.S3_ENDPOINT || 'default (AWS)'}`;
  }

  public async start(): Promise<void> {
    if (!this.usesObjectStorage) {
      return;
    }

    if (this.process) {
      console.log('[litestream] Process already running');
      return;
    }

    await this.ensureConfigExists();
    console.log(`[litestream] config=${this.configPath} ${this.describeTarget()}`);

    const { error } = await withError(fs.access(this.configPath));

    if (error) {
      console.warn('[litestream] Config file not found, skipping replication');
      return;
    }

    const dbExists = await this.databaseExists();
    if (!dbExists) {
      console.warn('[litestream] Database file not found, skipping replication');
      return;
    }

    console.log(`[litestream] starting replication for ${this.dbPath}`);

    const litestreamEnv = this.buildLitestreamEnv();

    this.process = spawn('litestream', ['replicate', '-config', this.configPath], {
      stdio: 'pipe',
      env: litestreamEnv,
    });

    this.process.stdout?.on('data', (data) => {
      console.log(`[litestream] ${data.toString().trim()}`);
    });

    this.process.stderr?.on('data', (data) => {
      console.error(`[litestream] ${data.toString().trim()}`);
    });

    this.process.on('error', (error) => {
      console.error('[litestream] Process error:', error);
    });

    this.process.on('exit', (code, signal) => {
      console.log(`[litestream] Process exited with code ${code} and signal ${signal}`);
      this.process = null;
    });
  }

  public async stop(): Promise<void> {
    if (!this.usesObjectStorage) {
      return;
    }

    if (!this.process) {
      console.log('[litestream] No process to stop');
      return;
    }

    console.log('[litestream] Stopping replication process');

    this.process.kill('SIGTERM');

    await Promise.race([
      new Promise<void>((resolve) => {
        this.process?.on('exit', () => resolve());
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);

    if (this.process && !this.process.killed) {
      console.log('[litestream] Force killing process');
      this.process.kill('SIGKILL');
    }

    this.process = null;
    console.log('[litestream] Replication stopped');
  }

  public isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }
}

export const litestreamService = LitestreamService.getInstance();

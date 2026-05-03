import { type ChildProcess, exec, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { env } from '../../config/env.js';
import { withError } from '../withError.js';

const litestreamProcess = Symbol.for('playwright.reports.litestream');
const instance = globalThis as typeof globalThis & {
  [litestreamProcess]?: LitestreamService;
};

/**
 * Service to manage Litestream process for SQLite replication to S3.
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

  private generateConfig(): string {
    const s3Path = 'litestream';
    const bucket = env.S3_BUCKET;
    const region = env.S3_REGION || 'us-east-1';
    const endpoint = env.S3_ENDPOINT;
    const accessKeyId = env.S3_ACCESS_KEY;
    const secretAccessKey = env.S3_SECRET_KEY;

    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'Missing required S3 configuration for Litestream: S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY'
      );
    }

    const absoluteDbPath = path.resolve(this.dbPath);

    return `
# Litestream configuration for SQLite replication to S3
# See: https://litestream.io/reference/config/
dbs:
  - path: ${absoluteDbPath}
    replicas:
      - url: s3://${bucket}/${s3Path}/metadata.db
        access-key-id: ${accessKeyId}
        secret-access-key: ${secretAccessKey}
        region: ${region}
        ${endpoint ? `endpoint: ${endpoint}` : ''}
        force-path-style: true
        sync-interval: 1s
        snapshot-interval: 3h
        retention: 24h
        retention-check-interval: 1h
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

  public async restoreIfNeeded(): Promise<boolean> {
    if (!this.usesS3) {
      return false;
    }

    await this.ensureConfigExists();
    const dbExists = await this.databaseExists();

    if (!dbExists) {
      console.log('[litestream] No local sqlite found, attempting restore from S3...');
      const restored = await this.restoreFromS3();
      if (restored) {
        console.log('[litestream] Successfully restored sqlite from S3');
      } else {
        console.log('[litestream] No sqlite found on S3, will start fresh');
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

  private async hasRemoteBackup(): Promise<boolean> {
    const litestreamEnv = this.buildLitestreamEnv();

    return new Promise((resolve) => {
      exec(
        `litestream generations -config ${this.configPath}`,
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
        `litestream restore -config ${this.configPath} -o ${this.dbPath} --if-replica-exists`,
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

  private async restoreFromS3(): Promise<boolean> {
    const litestreamEnv = this.buildLitestreamEnv();

    return new Promise((resolve) => {
      exec(
        `litestream restore -config ${this.configPath} -o ${this.dbPath}`,
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

  public async start(): Promise<void> {
    if (!this.usesS3) {
      return;
    }

    if (this.process) {
      console.log('[litestream] Process already running');
      return;
    }

    await this.ensureConfigExists();
    console.log(
      `[litestream] config=${this.configPath} bucket=${env.S3_BUCKET} endpoint=${env.S3_ENDPOINT || 'default (AWS)'}`
    );

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
    if (!this.usesS3) {
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

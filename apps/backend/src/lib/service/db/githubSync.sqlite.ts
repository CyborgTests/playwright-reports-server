import type Database from 'better-sqlite3';
import { getDatabase } from './db.js';

import { singletonOf } from './singleton.js';
export interface GithubSyncConfigRow {
  id: string;
  name: string;
  enabled: number;
  repo: string;
  workflow: string;
  tokenCipher: string | null;
  startDate: string;
  artifactPattern: string;
  projectTemplate: string;
  titleTemplate: string;
  cronSchedule: string;
  createdAt: string;
  updatedAt: string;
}

export interface GithubSyncStateRow {
  artifactId: string;
  syncConfigId: string;
  reportId: string;
  runId: string;
  env: string | null;
  runDate: string | null;
  uploadedAt: string;
}

export interface GithubSyncRunRow {
  id: string;
  syncConfigId: string;
  status: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  uploaded: number;
  skipped: number;
  failed: number;
  message: string | null;
}

export class GithubSyncDatabase {
  private readonly db = getDatabase();

  private readonly listConfigsStmt: Database.Statement<[]>;
  private readonly getConfigStmt: Database.Statement<[string]>;
  private readonly insertConfigStmt: Database.Statement<
    [
      string,
      string,
      number,
      string,
      string,
      string | null,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  >;
  private readonly updateConfigStmt: Database.Statement<
    [
      string,
      number,
      string,
      string,
      string | null,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
  >;
  private readonly setEnabledStmt: Database.Statement<[number, string, string]>;
  private readonly deleteConfigStmt: Database.Statement<[string]>;

  private readonly insertStateStmt: Database.Statement<
    [string, string, string, string, string | null, string | null, string]
  >;
  private readonly hasArtifactStmt: Database.Statement<[string]>;
  private readonly deleteStateByConfigStmt: Database.Statement<[string]>;
  private readonly countStateByConfigStmt: Database.Statement<[string]>;

  private readonly insertRunStmt: Database.Statement<[string, string, string, string, string]>;
  private readonly updateRunStmt: Database.Statement<
    [string, string | null, number, number, number, string | null, string]
  >;
  private readonly latestRunStmt: Database.Statement<[string]>;
  private readonly deleteRunsByConfigStmt: Database.Statement<[string]>;
  private readonly failStaleRunningStmt: Database.Statement<[string, string]>;

  constructor() {
    this.listConfigsStmt = this.db.prepare(
      'SELECT * FROM github_sync_configs ORDER BY createdAt ASC'
    );
    this.getConfigStmt = this.db.prepare('SELECT * FROM github_sync_configs WHERE id = ?');
    this.insertConfigStmt = this.db.prepare(`
      INSERT INTO github_sync_configs (
        id, name, enabled, repo, workflow, tokenCipher, startDate,
        artifactPattern, projectTemplate, titleTemplate, cronSchedule,
        createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.updateConfigStmt = this.db.prepare(`
      UPDATE github_sync_configs SET
        name = ?, enabled = ?, repo = ?, workflow = ?, tokenCipher = ?,
        startDate = ?, artifactPattern = ?, projectTemplate = ?,
        titleTemplate = ?, cronSchedule = ?, updatedAt = ?
      WHERE id = ?
    `);
    this.setEnabledStmt = this.db.prepare(
      'UPDATE github_sync_configs SET enabled = ?, updatedAt = ? WHERE id = ?'
    );
    this.deleteConfigStmt = this.db.prepare('DELETE FROM github_sync_configs WHERE id = ?');

    this.insertStateStmt = this.db.prepare(`
      INSERT OR REPLACE INTO github_sync_state
        (artifactId, syncConfigId, reportId, runId, env, runDate, uploadedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.hasArtifactStmt = this.db.prepare(
      'SELECT 1 FROM github_sync_state WHERE artifactId = ? LIMIT 1'
    );
    this.deleteStateByConfigStmt = this.db.prepare(
      'DELETE FROM github_sync_state WHERE syncConfigId = ?'
    );
    this.countStateByConfigStmt = this.db.prepare(
      'SELECT COUNT(*) as count FROM github_sync_state WHERE syncConfigId = ?'
    );

    this.insertRunStmt = this.db.prepare(`
      INSERT INTO github_sync_runs (id, syncConfigId, status, trigger, startedAt)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.updateRunStmt = this.db.prepare(`
      UPDATE github_sync_runs SET
        status = ?, finishedAt = ?, uploaded = ?, skipped = ?, failed = ?, message = ?
      WHERE id = ?
    `);
    this.latestRunStmt = this.db.prepare(
      'SELECT * FROM github_sync_runs WHERE syncConfigId = ? ORDER BY startedAt DESC LIMIT 1'
    );
    this.deleteRunsByConfigStmt = this.db.prepare(
      'DELETE FROM github_sync_runs WHERE syncConfigId = ?'
    );
    this.failStaleRunningStmt = this.db.prepare(`
      UPDATE github_sync_runs
      SET status = 'failed', finishedAt = ?, message = ?
      WHERE status = 'running'
    `);
  }

  public listConfigs(): GithubSyncConfigRow[] {
    return this.listConfigsStmt.all() as GithubSyncConfigRow[];
  }

  public getConfig(id: string): GithubSyncConfigRow | undefined {
    return this.getConfigStmt.get(id) as GithubSyncConfigRow | undefined;
  }

  public insertConfig(row: Omit<GithubSyncConfigRow, never>): void {
    this.insertConfigStmt.run(
      row.id,
      row.name,
      row.enabled,
      row.repo,
      row.workflow,
      row.tokenCipher,
      row.startDate,
      row.artifactPattern,
      row.projectTemplate,
      row.titleTemplate,
      row.cronSchedule,
      row.createdAt,
      row.updatedAt
    );
  }

  public updateConfig(id: string, patch: Omit<GithubSyncConfigRow, 'id' | 'createdAt'>): void {
    this.updateConfigStmt.run(
      patch.name,
      patch.enabled,
      patch.repo,
      patch.workflow,
      patch.tokenCipher,
      patch.startDate,
      patch.artifactPattern,
      patch.projectTemplate,
      patch.titleTemplate,
      patch.cronSchedule,
      patch.updatedAt,
      id
    );
  }

  public setEnabled(id: string, enabled: boolean): void {
    this.setEnabledStmt.run(enabled ? 1 : 0, new Date().toISOString(), id);
  }

  public deleteConfig(id: string): void {
    this.deleteConfigStmt.run(id);
  }

  public hasArtifact(artifactId: string): boolean {
    return !!this.hasArtifactStmt.get(artifactId);
  }

  public recordSyncedArtifact(row: GithubSyncStateRow): void {
    this.insertStateStmt.run(
      row.artifactId,
      row.syncConfigId,
      row.reportId,
      row.runId,
      row.env,
      row.runDate,
      row.uploadedAt
    );
  }

  public clearStateForConfig(syncConfigId: string): number {
    const info = this.deleteStateByConfigStmt.run(syncConfigId);
    return info.changes;
  }

  public countSyncedArtifacts(syncConfigId: string): number {
    const row = this.countStateByConfigStmt.get(syncConfigId) as { count: number };
    return row?.count ?? 0;
  }

  public startRun(args: {
    id: string;
    syncConfigId: string;
    trigger: 'cron' | 'manual';
    startedAt: string;
  }): void {
    this.insertRunStmt.run(args.id, args.syncConfigId, 'running', args.trigger, args.startedAt);
  }

  public finishRun(args: {
    id: string;
    status: 'success' | 'failed' | 'cancelled';
    finishedAt: string;
    uploaded: number;
    skipped: number;
    failed: number;
    message?: string;
  }): void {
    this.updateRunStmt.run(
      args.status,
      args.finishedAt,
      args.uploaded,
      args.skipped,
      args.failed,
      args.message ?? null,
      args.id
    );
  }

  public getLatestRun(syncConfigId: string): GithubSyncRunRow | undefined {
    return this.latestRunStmt.get(syncConfigId) as GithubSyncRunRow | undefined;
  }

  public deleteRunsForConfig(syncConfigId: string): number {
    const info = this.deleteRunsByConfigStmt.run(syncConfigId);
    return info.changes;
  }

  public failStaleRunning(message: string): number {
    const info = this.failStaleRunningStmt.run(new Date().toISOString(), message);
    return info.changes;
  }
}

export const githubSyncDb = singletonOf('githubSync', () => new GithubSyncDatabase());

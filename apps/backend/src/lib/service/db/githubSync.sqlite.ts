import { getDatabase } from './db.js';
import {
  type GithubSyncConfigsRow,
  type GithubSyncRunsRow,
  type GithubSyncStateRow,
  getKysely,
} from './kysely.js';
import { singletonOf } from './singleton.js';

export type GithubSyncConfigRow = GithubSyncConfigsRow;
export type { GithubSyncStateRow };
export type GithubSyncRunRow = GithubSyncRunsRow;

export class GithubSyncDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();

  public listConfigs(): GithubSyncConfigRow[] {
    const compiled = this.k
      .selectFrom('github_sync_configs')
      .selectAll()
      .orderBy('createdAt', 'asc')
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as GithubSyncConfigRow[];
  }

  public getConfig(id: string): GithubSyncConfigRow | undefined {
    const compiled = this.k
      .selectFrom('github_sync_configs')
      .selectAll()
      .where('id', '=', id)
      .compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | GithubSyncConfigRow
      | undefined;
  }

  public insertConfig(row: GithubSyncConfigRow): void {
    const compiled = this.k.insertInto('github_sync_configs').values(row).compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public updateConfig(id: string, patch: Omit<GithubSyncConfigRow, 'id' | 'createdAt'>): void {
    const compiled = this.k
      .updateTable('github_sync_configs')
      .set({
        name: patch.name,
        enabled: patch.enabled,
        repo: patch.repo,
        workflow: patch.workflow,
        tokenCipher: patch.tokenCipher,
        startDate: patch.startDate,
        artifactPattern: patch.artifactPattern,
        projectTemplate: patch.projectTemplate,
        titleTemplate: patch.titleTemplate,
        cronSchedule: patch.cronSchedule,
        updatedAt: patch.updatedAt,
      })
      .where('id', '=', id)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public setEnabled(id: string, enabled: boolean): void {
    const compiled = this.k
      .updateTable('github_sync_configs')
      .set({ enabled: enabled ? 1 : 0, updatedAt: new Date().toISOString() })
      .where('id', '=', id)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public deleteConfig(id: string): void {
    const compiled = this.k.deleteFrom('github_sync_configs').where('id', '=', id).compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public hasArtifact(artifactId: string): boolean {
    const compiled = this.k
      .selectFrom('github_sync_state')
      .select('artifactId')
      .where('artifactId', '=', artifactId)
      .limit(1)
      .compile();
    return !!this.db.prepare(compiled.sql).get(...compiled.parameters);
  }

  public recordSyncedArtifact(row: GithubSyncStateRow): void {
    const compiled = this.k
      .insertInto('github_sync_state')
      .values(row)
      .onConflict((oc) =>
        oc.column('artifactId').doUpdateSet((eb) => ({
          syncConfigId: eb.ref('excluded.syncConfigId'),
          reportId: eb.ref('excluded.reportId'),
          runId: eb.ref('excluded.runId'),
          env: eb.ref('excluded.env'),
          runDate: eb.ref('excluded.runDate'),
          uploadedAt: eb.ref('excluded.uploadedAt'),
        }))
      )
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public clearStateForConfig(syncConfigId: string): number {
    const compiled = this.k
      .deleteFrom('github_sync_state')
      .where('syncConfigId', '=', syncConfigId)
      .compile();
    return Number(this.db.prepare(compiled.sql).run(...compiled.parameters).changes ?? 0);
  }

  public countSyncedArtifacts(syncConfigId: string): number {
    const compiled = this.k
      .selectFrom('github_sync_state')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('syncConfigId', '=', syncConfigId)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | { count: number }
      | undefined;
    return row?.count ?? 0;
  }

  public startRun(args: {
    id: string;
    syncConfigId: string;
    trigger: 'cron' | 'manual';
    startedAt: string;
  }): void {
    const compiled = this.k
      .insertInto('github_sync_runs')
      .values({
        id: args.id,
        syncConfigId: args.syncConfigId,
        status: 'running',
        trigger: args.trigger,
        startedAt: args.startedAt,
        finishedAt: null,
        uploaded: 0,
        skipped: 0,
        failed: 0,
        message: null,
      })
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
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
    const compiled = this.k
      .updateTable('github_sync_runs')
      .set({
        status: args.status,
        finishedAt: args.finishedAt,
        uploaded: args.uploaded,
        skipped: args.skipped,
        failed: args.failed,
        message: args.message ?? null,
      })
      .where('id', '=', args.id)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public getLatestRun(syncConfigId: string): GithubSyncRunRow | undefined {
    const compiled = this.k
      .selectFrom('github_sync_runs')
      .selectAll()
      .where('syncConfigId', '=', syncConfigId)
      .orderBy('startedAt', 'desc')
      .limit(1)
      .compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | GithubSyncRunRow
      | undefined;
  }

  public deleteRunsForConfig(syncConfigId: string): number {
    const compiled = this.k
      .deleteFrom('github_sync_runs')
      .where('syncConfigId', '=', syncConfigId)
      .compile();
    return Number(this.db.prepare(compiled.sql).run(...compiled.parameters).changes ?? 0);
  }

  public failStaleRunning(message: string): number {
    const compiled = this.k
      .updateTable('github_sync_runs')
      .set({ status: 'failed', finishedAt: new Date().toISOString(), message })
      .where('status', '=', 'running')
      .compile();
    return Number(this.db.prepare(compiled.sql).run(...compiled.parameters).changes ?? 0);
  }
}

export const githubSyncDb = singletonOf('githubSync', () => new GithubSyncDatabase());

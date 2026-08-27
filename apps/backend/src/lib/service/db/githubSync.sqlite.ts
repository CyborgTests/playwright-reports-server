import type { GithubSyncRunOutcome } from '@playwright-reports/shared';
import { getDatabase } from './db.js';
import {
  type GithubSyncConfigsRow,
  type GithubSyncFailedArtifactsRow,
  type GithubSyncRunsRow,
  type GithubSyncStateRow,
  getKysely,
} from './kysely.js';
import { singletonOf } from './singleton.js';

export type GithubSyncConfigRow = GithubSyncConfigsRow;
export type { GithubSyncStateRow };
export type GithubSyncRunRow = GithubSyncRunsRow;
export type GithubSyncFailedArtifactRow = GithubSyncFailedArtifactsRow;

export interface RunOutcomeRow {
  status: string;
  startedAt: string;
}

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
    status: GithubSyncRunOutcome;
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

  public getLatestRunsBatch(syncConfigIds: string[]): Map<string, GithubSyncRunRow> {
    const out = new Map<string, GithubSyncRunRow>();
    if (syncConfigIds.length === 0) return out;
    const placeholders = syncConfigIds.map(() => '?').join(', ');
    const sqlText = `
      SELECT * FROM (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY syncConfigId ORDER BY startedAt DESC, id DESC
        ) AS rn
        FROM github_sync_runs
        WHERE syncConfigId IN (${placeholders})
      ) WHERE rn = 1
    `;
    const rows = this.db.prepare(sqlText).all(...syncConfigIds) as Array<
      GithubSyncRunRow & { rn: number }
    >;
    for (const row of rows) {
      const { rn: _rn, ...rest } = row;
      out.set(row.syncConfigId, rest as GithubSyncRunRow);
    }
    return out;
  }

  public listFailedArtifacts(syncConfigId: string): GithubSyncFailedArtifactRow[] {
    const compiled = this.k
      .selectFrom('github_sync_failed_artifacts')
      .selectAll()
      .where('syncConfigId', '=', syncConfigId)
      .orderBy('firstFailedAt', 'desc')
      .compile();
    return this.db
      .prepare(compiled.sql)
      .all(...compiled.parameters) as GithubSyncFailedArtifactRow[];
  }

  public recordFailedArtifact(row: Omit<GithubSyncFailedArtifactRow, 'attempts'>): void {
    const compiled = this.k
      .insertInto('github_sync_failed_artifacts')
      .values({ ...row, attempts: 1 })
      .onConflict((oc) =>
        oc.column('artifactId').doUpdateSet((eb) => ({
          syncConfigId: eb.ref('excluded.syncConfigId'),
          runId: eb.ref('excluded.runId'),
          artifactName: eb.ref('excluded.artifactName'),
          env: eb.ref('excluded.env'),
          runDate: eb.ref('excluded.runDate'),
          headBranch: eb.ref('excluded.headBranch'),
          workflowName: eb.ref('excluded.workflowName'),
          phase: eb.ref('excluded.phase'),
          lastError: eb.ref('excluded.lastError'),
          lastAttemptAt: eb.ref('excluded.lastAttemptAt'),
          abandonedReason: eb.ref('excluded.abandonedReason'),
          attempts: eb('github_sync_failed_artifacts.attempts', '+', 1),
        }))
      )
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public noteRetryFailure(artifactId: string, lastError: string): void {
    const compiled = this.k
      .updateTable('github_sync_failed_artifacts')
      .set((eb) => ({
        lastError,
        lastAttemptAt: new Date().toISOString(),
        attempts: eb('attempts', '+', 1),
      }))
      .where('artifactId', '=', artifactId)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public clearFailedArtifact(artifactId: string): void {
    const compiled = this.k
      .deleteFrom('github_sync_failed_artifacts')
      .where('artifactId', '=', artifactId)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public abandonFailedArtifact(artifactId: string, reason: 'expired'): void {
    const compiled = this.k
      .updateTable('github_sync_failed_artifacts')
      .set((eb) => ({
        abandonedReason: reason,
        lastAttemptAt: new Date().toISOString(),
        attempts: eb('attempts', '+', 1),
      }))
      .where('artifactId', '=', artifactId)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public clearFailedArtifactsForConfig(syncConfigId: string): number {
    const compiled = this.k
      .deleteFrom('github_sync_failed_artifacts')
      .where('syncConfigId', '=', syncConfigId)
      .compile();
    return Number(this.db.prepare(compiled.sql).run(...compiled.parameters).changes ?? 0);
  }

  public countFailedArtifactsBatch(
    syncConfigIds: string[]
  ): Map<string, { pending: number; abandoned: number }> {
    const out = new Map<string, { pending: number; abandoned: number }>();
    if (syncConfigIds.length === 0) return out;
    const placeholders = syncConfigIds.map(() => '?').join(', ');
    const sqlText = `
      SELECT syncConfigId,
             SUM(CASE WHEN abandonedReason IS NULL THEN 1 ELSE 0 END) AS pending,
             SUM(CASE WHEN abandonedReason IS NOT NULL THEN 1 ELSE 0 END) AS abandoned
      FROM github_sync_failed_artifacts
      WHERE syncConfigId IN (${placeholders})
      GROUP BY syncConfigId
    `;
    const rows = this.db.prepare(sqlText).all(...syncConfigIds) as Array<{
      syncConfigId: string;
      pending: number;
      abandoned: number;
    }>;
    for (const row of rows) {
      out.set(row.syncConfigId, { pending: row.pending, abandoned: row.abandoned });
    }
    return out;
  }

  public listRuns(
    syncConfigId: string,
    options: { limit: number; offset: number; includeEmpty: boolean }
  ): { rows: GithubSyncRunRow[]; total: number } {
    const base = () => {
      let query = this.k.selectFrom('github_sync_runs').where('syncConfigId', '=', syncConfigId);
      if (!options.includeEmpty) {
        query = query.where((eb) =>
          eb.not(
            eb.and([eb('status', '=', 'success'), eb('uploaded', '=', 0), eb('failed', '=', 0)])
          )
        );
      }
      return query;
    };

    const countCompiled = base()
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .compile();
    const total =
      (
        this.db.prepare(countCompiled.sql).get(...countCompiled.parameters) as
          | { count: number }
          | undefined
      )?.count ?? 0;

    const compiled = base()
      .selectAll()
      .orderBy('startedAt', 'desc')
      .limit(options.limit)
      .offset(options.offset)
      .compile();
    return {
      rows: this.db.prepare(compiled.sql).all(...compiled.parameters) as GithubSyncRunRow[],
      total,
    };
  }

  public recentRunOutcomesBatch(
    syncConfigIds: string[],
    limitPerConfig: number
  ): Map<string, RunOutcomeRow[]> {
    const out = new Map<string, RunOutcomeRow[]>();
    if (syncConfigIds.length === 0) return out;
    const placeholders = syncConfigIds.map(() => '?').join(', ');
    const sqlText = `
      SELECT syncConfigId, status, startedAt FROM (
        SELECT syncConfigId, status, startedAt, ROW_NUMBER() OVER (
          PARTITION BY syncConfigId ORDER BY startedAt DESC
        ) AS rn
        FROM github_sync_runs
        WHERE syncConfigId IN (${placeholders}) AND status != 'running'
      ) WHERE rn <= ?
      ORDER BY syncConfigId, startedAt DESC
    `;
    const rows = this.db.prepare(sqlText).all(...syncConfigIds, limitPerConfig) as Array<
      RunOutcomeRow & { syncConfigId: string }
    >;
    for (const row of rows) {
      const bucket = out.get(row.syncConfigId);
      if (bucket) bucket.push({ status: row.status, startedAt: row.startedAt });
      else out.set(row.syncConfigId, [{ status: row.status, startedAt: row.startedAt }]);
    }
    return out;
  }

  public pruneRuns(
    syncConfigId: string,
    cutoffs: { noopBefore: string; allBefore: string }
  ): number {
    const compiled = this.k
      .deleteFrom('github_sync_runs')
      .where('syncConfigId', '=', syncConfigId)
      .where((eb) =>
        eb.or([
          eb('startedAt', '<', cutoffs.allBefore),
          eb.and([
            eb('status', '=', 'success'),
            eb('uploaded', '=', 0),
            eb('failed', '=', 0),
            eb('startedAt', '<', cutoffs.noopBefore),
          ]),
        ])
      )
      .compile();
    return Number(this.db.prepare(compiled.sql).run(...compiled.parameters).changes ?? 0);
  }

  public countSyncedArtifactsBatch(syncConfigIds: string[]): Map<string, number> {
    const out = new Map<string, number>();
    if (syncConfigIds.length === 0) return out;
    const placeholders = syncConfigIds.map(() => '?').join(', ');
    const sqlText = `
      SELECT syncConfigId, COUNT(*) AS count FROM github_sync_state
      WHERE syncConfigId IN (${placeholders})
      GROUP BY syncConfigId
    `;
    const rows = this.db.prepare(sqlText).all(...syncConfigIds) as Array<{
      syncConfigId: string;
      count: number;
    }>;
    for (const row of rows) {
      out.set(row.syncConfigId, row.count);
    }
    return out;
  }
}

export const githubSyncDb = singletonOf('githubSync', () => new GithubSyncDatabase());

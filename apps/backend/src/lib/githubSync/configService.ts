import { randomUUID } from 'node:crypto';
import type {
  GithubSyncConfig,
  GithubSyncConfigInput,
  GithubSyncFailedArtifact,
  GithubSyncRun,
  GithubSyncRunStatus,
  GithubSyncStatus,
} from '@playwright-reports/shared';
import {
  type GithubSyncConfigRow,
  type GithubSyncFailedArtifactRow,
  type GithubSyncRunRow,
  githubSyncDb,
  type RunOutcomeRow,
} from '../service/db/index.js';
import { decryptToken, encryptToken } from './encryption.js';
import { githubSyncEvents } from './events.js';
import { getSyncProgress } from './syncService.js';

export interface GithubSyncConfigResolved extends GithubSyncConfig {
  token: string | undefined;
}

function rowToPublic(row: GithubSyncConfigRow): GithubSyncConfig {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    repo: row.repo,
    workflow: row.workflow,
    tokenSet: !!row.tokenCipher,
    startDate: row.startDate,
    artifactPattern: row.artifactPattern,
    projectTemplate: row.projectTemplate,
    titleTemplate: row.titleTemplate,
    cronSchedule: row.cronSchedule,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToResolved(row: GithubSyncConfigRow): GithubSyncConfigResolved {
  const envFallback = process.env.GITHUB_TOKEN;
  const decrypted = decryptToken(row.tokenCipher);
  return {
    ...rowToPublic(row),
    token: decrypted || envFallback || undefined,
  };
}

function runRowToPublic(row: GithubSyncRunRow): GithubSyncRun {
  return {
    id: row.id,
    syncConfigId: row.syncConfigId,
    status: row.status as GithubSyncRunStatus,
    trigger: row.trigger as 'cron' | 'manual',
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? undefined,
    uploaded: row.uploaded,
    skipped: row.skipped,
    failed: row.failed,
    message: row.message ?? undefined,
  };
}

function failedArtifactRowToPublic(row: GithubSyncFailedArtifactRow): GithubSyncFailedArtifact {
  return {
    artifactId: row.artifactId,
    runId: row.runId,
    artifactName: row.artifactName,
    runDate: row.runDate ?? undefined,
    phase: row.phase === 'upload' ? 'upload' : 'download',
    attempts: row.attempts,
    lastError: row.lastError ?? undefined,
    lastAttemptAt: row.lastAttemptAt,
    abandonedReason: row.abandonedReason === 'expired' ? 'expired' : undefined,
  };
}

const FAILURE_STREAK_WINDOW = 10;

function consecutiveFailures(rows: RunOutcomeRow[]): { count: number; since?: string } {
  let count = 0;
  let since: string | undefined;
  for (const row of rows) {
    if (row.status !== 'failed' && row.status !== 'partial') break;
    count++;
    since = row.startedAt;
  }
  return { count, since };
}

export const githubSyncConfigService = {
  list(): GithubSyncConfig[] {
    return githubSyncDb.listConfigs().map(rowToPublic);
  },

  listWithStatus(
    nextRunOf: (id: string) => string | undefined
  ): Array<GithubSyncConfig & { status: GithubSyncStatus }> {
    const configs = githubSyncDb.listConfigs();
    const ids = configs.map((c) => c.id);
    const latestRuns = githubSyncDb.getLatestRunsBatch(ids);
    const counts = githubSyncDb.countSyncedArtifactsBatch(ids);
    const failedCounts = githubSyncDb.countFailedArtifactsBatch(ids);
    const recentOutcomes = githubSyncDb.recentRunOutcomesBatch(ids, FAILURE_STREAK_WINDOW);
    return configs.map((row) => {
      const latest = latestRuns.get(row.id);
      const isRunning = latest?.status === 'running';
      const streak = consecutiveFailures(recentOutcomes.get(row.id) ?? []);
      const failures = failedCounts.get(row.id);
      const status: GithubSyncStatus = {
        configId: row.id,
        isRunning,
        lastRun: latest ? runRowToPublic(latest) : undefined,
        nextRun: nextRunOf(row.id),
        syncedArtifacts: counts.get(row.id) ?? 0,
        pendingArtifacts: failures?.pending ?? 0,
        abandonedArtifacts: failures?.abandoned ?? 0,
        consecutiveFailures: streak.count,
        failingSince: streak.since,
        progress: isRunning ? (getSyncProgress(row.id) ?? undefined) : undefined,
      };
      return { ...rowToPublic(row), status };
    });
  },

  listRuns(
    id: string,
    options: { limit: number; offset: number; includeEmpty: boolean }
  ): { runs: GithubSyncRun[]; total: number } {
    const { rows, total } = githubSyncDb.listRuns(id, options);
    return { runs: rows.map(runRowToPublic), total };
  },

  listFailedArtifacts(id: string): GithubSyncFailedArtifact[] {
    return githubSyncDb.listFailedArtifacts(id).map(failedArtifactRowToPublic);
  },

  get(id: string): GithubSyncConfig | undefined {
    const row = githubSyncDb.getConfig(id);
    return row ? rowToPublic(row) : undefined;
  },

  getResolved(id: string): GithubSyncConfigResolved | undefined {
    const row = githubSyncDb.getConfig(id);
    return row ? rowToResolved(row) : undefined;
  },

  create(input: GithubSyncConfigInput): GithubSyncConfig {
    const id = randomUUID();
    const now = new Date().toISOString();
    const row: GithubSyncConfigRow = {
      id,
      name: input.name.trim(),
      enabled: input.enabled === false ? 0 : 1,
      repo: input.repo.trim(),
      workflow: input.workflow.trim(),
      tokenCipher: input.token ? encryptToken(input.token) : null,
      startDate: input.startDate,
      artifactPattern: input.artifactPattern,
      projectTemplate: input.projectTemplate,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder rendered at sync time
      titleTemplate: input.titleTemplate ?? '${runDate}',
      cronSchedule: input.cronSchedule,
      createdAt: now,
      updatedAt: now,
    };
    githubSyncDb.insertConfig(row);
    githubSyncEvents.emitChanged();
    return rowToPublic(row);
  },

  update(id: string, input: Partial<GithubSyncConfigInput>): GithubSyncConfig | undefined {
    const existing = githubSyncDb.getConfig(id);
    if (!existing) return undefined;

    // Token rules: undefined → keep; '' → clear; non-empty → encrypt and store.
    let tokenCipher = existing.tokenCipher;
    if (input.token !== undefined) {
      tokenCipher = input.token === '' ? null : encryptToken(input.token);
    }

    const updated: GithubSyncConfigRow = {
      ...existing,
      name: input.name?.trim() ?? existing.name,
      enabled: input.enabled === undefined ? existing.enabled : input.enabled ? 1 : 0,
      repo: input.repo?.trim() ?? existing.repo,
      workflow: input.workflow?.trim() ?? existing.workflow,
      tokenCipher,
      startDate: input.startDate ?? existing.startDate,
      artifactPattern: input.artifactPattern ?? existing.artifactPattern,
      projectTemplate: input.projectTemplate ?? existing.projectTemplate,
      titleTemplate: input.titleTemplate ?? existing.titleTemplate,
      cronSchedule: input.cronSchedule ?? existing.cronSchedule,
      updatedAt: new Date().toISOString(),
    };
    githubSyncDb.updateConfig(id, updated);
    githubSyncEvents.emitChanged();
    return rowToPublic(updated);
  },

  setEnabled(id: string, enabled: boolean): boolean {
    const row = githubSyncDb.getConfig(id);
    if (!row) return false;
    githubSyncDb.setEnabled(id, enabled);
    githubSyncEvents.emitChanged();
    return true;
  },

  delete(id: string, options: { clearState: boolean }): boolean {
    const row = githubSyncDb.getConfig(id);
    if (!row) return false;
    githubSyncDb.deleteRunsForConfig(id);
    githubSyncDb.clearFailedArtifactsForConfig(id);
    if (options.clearState) {
      githubSyncDb.clearStateForConfig(id);
    }
    githubSyncDb.deleteConfig(id);
    githubSyncEvents.emitChanged();
    return true;
  },
};

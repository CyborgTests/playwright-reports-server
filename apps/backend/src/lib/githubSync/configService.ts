import { randomUUID } from 'node:crypto';
import type {
  GithubSyncConfig,
  GithubSyncConfigInput,
  GithubSyncRun,
  GithubSyncRunStatus,
  GithubSyncStatus,
} from '@playwright-reports/shared';
import {
  type GithubSyncConfigRow,
  type GithubSyncRunRow,
  githubSyncDb,
} from '../service/db/githubSync.sqlite.js';
import { decryptToken, encryptToken } from './encryption.js';
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
    return configs.map((row) => {
      const latest = latestRuns.get(row.id);
      const isRunning = latest?.status === 'running';
      const status: GithubSyncStatus = {
        configId: row.id,
        isRunning,
        lastRun: latest ? runRowToPublic(latest) : undefined,
        nextRun: nextRunOf(row.id),
        syncedArtifacts: counts.get(row.id) ?? 0,
        progress: isRunning ? (getSyncProgress(row.id) ?? undefined) : undefined,
      };
      return { ...rowToPublic(row), status };
    });
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
    return rowToPublic(updated);
  },

  setEnabled(id: string, enabled: boolean): boolean {
    const row = githubSyncDb.getConfig(id);
    if (!row) return false;
    githubSyncDb.setEnabled(id, enabled);
    return true;
  },

  delete(id: string, options: { clearState: boolean }): boolean {
    const row = githubSyncDb.getConfig(id);
    if (!row) return false;
    githubSyncDb.deleteRunsForConfig(id);
    if (options.clearState) {
      githubSyncDb.clearStateForConfig(id);
    }
    githubSyncDb.deleteConfig(id);
    return true;
  },

  status(id: string, nextRun?: string): GithubSyncStatus | undefined {
    const row = githubSyncDb.getConfig(id);
    if (!row) return undefined;
    const latest = githubSyncDb.getLatestRun(id);
    const isRunning = latest?.status === 'running';
    return {
      configId: id,
      isRunning,
      lastRun: latest ? runRowToPublic(latest) : undefined,
      nextRun,
      syncedArtifacts: githubSyncDb.countSyncedArtifacts(id),
      progress: isRunning ? (getSyncProgress(id) ?? undefined) : undefined,
    };
  },
};

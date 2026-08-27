import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { GithubSyncRunOutcome, SyncProgress } from '@playwright-reports/shared';
import { serveReportRoute } from '../constants.js';
import { githubSyncDb, reportDb } from '../service/db/index.js';
import { processReportOrRollback, retentionCutoff } from '../service/index.js';
import { storage } from '../storage/index.js';
import { withError } from '../withError.js';
import type { GithubSyncConfigResolved } from './configService.js';
import { githubSyncEvents } from './events.js';
import { type GhArtifact, GithubApiClient, GithubApiError } from './githubApi.js';
import { planScan, type ToUpload } from './scanPlanner.js';

const MAX_RUNS_PER_SCAN = 200;
const MAX_FAILURE_NOTES = 3;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_ERROR_LENGTH = 500;
const NOOP_RUN_RETENTION_DAYS = 30;
const RUN_RETENTION_DAYS = 365;

const TMP_DIR_PREFIX = 'gh-sync-';

export async function cleanupOrphanedTempDirs(): Promise<number> {
  const tmpRoot = os.tmpdir();
  const { result: entries, error } = await withError(fs.readdir(tmpRoot, { withFileTypes: true }));
  if (error || !entries) return 0;

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(TMP_DIR_PREFIX)) continue;
    const { error: rmErr } = await withError(
      fs.rm(path.join(tmpRoot, entry.name), { recursive: true, force: true })
    );
    if (!rmErr) removed++;
  }
  if (removed > 0) {
    console.log(`[github-sync] cleaned up ${removed} orphaned temp dir(s)`);
  }
  return removed;
}

class CancelledError extends Error {
  constructor() {
    super('sync cancelled');
    this.name = 'CancelledError';
  }
}

interface RunningHandle {
  runId: string;
  controller: AbortController;
  cancelled: boolean;
  progress: SyncProgress;
}

const running = new Map<string, RunningHandle>();

export function getSyncProgress(configId: string): SyncProgress | null {
  const handle = running.get(configId);
  if (!handle) return null;
  return { ...handle.progress };
}

export interface SyncResult {
  status: GithubSyncRunOutcome | 'skipped';
  uploaded: number;
  skipped: number;
  failed: number;
  message?: string;
}

export function isRunning(configId: string): boolean {
  return running.has(configId);
}

export function hasActiveRun(): boolean {
  return running.size > 0;
}

export function stopSync(configId: string): boolean {
  const handle = running.get(configId);
  if (!handle) return false;
  handle.cancelled = true;
  handle.controller.abort();
  return true;
}

function renderTemplate(
  template: string,
  ctx: Record<string, string | undefined>,
  matches: string[]
): string {
  return template.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    if (/^match\d+$/.test(key)) {
      const idx = Number.parseInt(key.slice(5), 10);
      return matches[idx] ?? '';
    }
    return ctx[key] ?? '';
  });
}

export async function runSync(
  cfg: GithubSyncConfigResolved,
  trigger: 'cron' | 'manual',
  options: { fullScan?: boolean } = {}
): Promise<SyncResult> {
  if (running.has(cfg.id)) {
    return {
      status: 'skipped',
      uploaded: 0,
      skipped: 0,
      failed: 0,
      message: 'previous run still in progress',
    };
  }

  let pattern: RegExp;
  try {
    pattern = new RegExp(cfg.artifactPattern);
  } catch (err) {
    return {
      status: 'failed',
      uploaded: 0,
      skipped: 0,
      failed: 0,
      message: `invalid artifact pattern: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const runId = randomUUID();
  const controller = new AbortController();
  const startedAtIso = new Date().toISOString();
  const handle: RunningHandle = {
    runId,
    controller,
    cancelled: false,
    progress: {
      phase: 'scanning',
      total: 0,
      current: 0,
      uploaded: 0,
      failed: 0,
      skipped: 0,
      startedAt: startedAtIso,
    },
  };
  running.set(cfg.id, handle);

  githubSyncDb.startRun({
    id: runId,
    syncConfigId: cfg.id,
    trigger,
    startedAt: startedAtIso,
  });
  githubSyncEvents.emitChanged();

  const api = new GithubApiClient(cfg.repo, cfg.token);
  const signal = controller.signal;

  let uploaded = 0;
  let skippedTotal = 0;
  let failed = 0;
  let earlyExit: string | undefined;
  let outcome: GithubSyncRunOutcome = 'success';
  let message: string | undefined;
  let prefetched: { tmpDir: string; zipPath: string } | null = null;
  let scanningRunId: number | undefined;
  let pendingUpload: Promise<{ ok: boolean; item: ToUpload; error?: Error }> | null = null;
  const failureNotes: string[] = [];

  const recordFailure = (item: ToUpload, phase: 'download' | 'upload', error?: Error): void => {
    const now = new Date().toISOString();
    githubSyncDb.recordFailedArtifact({
      artifactId: String(item.artifact.id),
      syncConfigId: cfg.id,
      runId: item.workflowRunId,
      artifactName: item.artifact.name,
      env: item.envMatch || null,
      runDate: item.runDate,
      headBranch: item.headBranch || null,
      workflowName: item.workflowName || null,
      phase,
      lastError: error?.message.slice(0, MAX_ERROR_LENGTH) ?? null,
      firstFailedAt: now,
      lastAttemptAt: now,
      abandonedReason: null,
    });
    failed++;
    handle.progress.failed = failed;
    const note = `artifact ${item.artifact.id} ${phase} failed: ${
      error?.message ?? 'unknown error'
    }`;
    if (failureNotes.length < MAX_FAILURE_NOTES) failureNotes.push(note);
    console.error(`[github-sync] ${cfg.name}: ${note}`);
  };

  try {
    console.log(
      `[github-sync] ${cfg.name} (${cfg.repo}/${cfg.workflow}) starting [${trigger}]${
        options.fullScan ? ' [full rescan]' : ''
      }`
    );

    const failureRows = githubSyncDb.listFailedArtifacts(cfg.id);
    const skipped = new Set(
      failureRows.filter((row) => row.abandonedReason).map((row) => row.artifactId)
    );
    const pendingFailures = failureRows.filter((row) => !row.abandonedReason);

    const runs = await api.listRunsSince({
      workflow: cfg.workflow,
      sinceISO: cfg.startDate,
      maxRuns: MAX_RUNS_PER_SCAN,
      signal,
    });
    if (runs.length >= MAX_RUNS_PER_SCAN) {
      console.log(
        `[github-sync] ${cfg.name}: scan capped at ${MAX_RUNS_PER_SCAN} runs - anything older than ${
          runs[runs.length - 1]?.created_at
        } was not inspected`
      );
    }

    const retryItems: ToUpload[] = [];
    let expiredNow = 0;
    let unresolvedRetries = 0;
    const listingByRun = new Map<string, GhArtifact[]>();
    for (const row of pendingFailures) {
      if (handle.cancelled) throw new CancelledError();
      let artifacts = listingByRun.get(row.runId);
      if (!artifacts) {
        const listing = await withError(api.listArtifacts(row.runId, signal));
        if (listing.error) {
          if (handle.cancelled || listing.error.name === 'AbortError') throw new CancelledError();
          const status = listing.error instanceof GithubApiError ? listing.error.status : 0;
          if (status === 404 || status === 410) {
            githubSyncDb.abandonFailedArtifact(row.artifactId, 'expired');
            skipped.add(row.artifactId);
            expiredNow++;
          } else {
            githubSyncDb.noteRetryFailure(
              row.artifactId,
              listing.error.message.slice(0, MAX_ERROR_LENGTH)
            );
            unresolvedRetries++;
            failed++;
            handle.progress.failed = failed;
            if (failureNotes.length < MAX_FAILURE_NOTES) {
              failureNotes.push(
                `artifact ${row.artifactId} could not be re-resolved: ${listing.error.message}`
              );
            }
            console.error(
              `[github-sync] ${cfg.name}: cannot re-resolve artifact ${row.artifactId} in run ${row.runId}: ${listing.error.message}`
            );
          }
          continue;
        }
        artifacts = listing.result ?? [];
        listingByRun.set(row.runId, artifacts);
      }
      const artifact = artifacts.find((candidate) => String(candidate.id) === row.artifactId);
      if (!artifact || artifact.expired) {
        githubSyncDb.abandonFailedArtifact(row.artifactId, 'expired');
        skipped.add(row.artifactId);
        expiredNow++;
        continue;
      }
      retryItems.push({
        artifact,
        workflowRunId: row.runId,
        runDate: row.runDate ?? artifact.created_at.slice(0, 10),
        headBranch: row.headBranch ?? '',
        workflowName: row.workflowName ?? '',
        envMatch: row.env ?? '',
      });
    }
    if (pendingFailures.length > 0) {
      console.log(
        `[github-sync] ${cfg.name}: retrying ${retryItems.length} failed artifact(s), ${expiredNow} expired, ${unresolvedRetries} unresolved`
      );
    }

    const plan = await planScan({
      runs,
      artifactsOf: async (workflowRunId) => {
        if (handle.cancelled) throw new CancelledError();
        scanningRunId = workflowRunId;
        const key = String(workflowRunId);
        let artifacts = listingByRun.get(key);
        if (!artifacts) {
          artifacts = await api.listArtifacts(workflowRunId, signal);
          listingByRun.set(key, artifacts);
        }
        return artifacts;
      },
      isSynced: (artifactId) => githubSyncDb.hasArtifact(artifactId),
      isAbandoned: (artifactId) => skipped.has(artifactId),
      pattern,
      fullScan: options.fullScan,
      onCounts: (counts) => {
        skippedTotal = counts.skippedSynced + counts.skippedExpired + counts.skippedAbandoned;
        handle.progress.skipped = skippedTotal;
        handle.progress.total = retryItems.length + counts.planned;
      },
    });
    earlyExit = plan.earlyExit;

    const seenArtifacts = new Set<number>();
    const toUpload = [...plan.toUpload, ...retryItems].filter((item) => {
      if (seenArtifacts.has(item.artifact.id)) return false;
      seenArtifacts.add(item.artifact.id);
      return true;
    });

    handle.progress.phase = 'downloading';
    handle.progress.total = toUpload.length;
    handle.progress.current = 0;

    if (earlyExit) {
      console.log(`[github-sync] ${cfg.name}: early exit - ${earlyExit}`);
    }

    const finishUpload = async (): Promise<void> => {
      if (!pendingUpload) return;
      const { ok, item, error } = await pendingUpload;
      pendingUpload = null;
      handle.progress.upload = undefined;
      if (ok) {
        uploaded++;
        handle.progress.uploaded = uploaded;
        return;
      }
      if (handle.cancelled || error?.name === 'AbortError') throw new CancelledError();
      recordFailure(item, 'upload', error);
    };

    for (let i = 0; i < toUpload.length; i++) {
      const item = toUpload[i];
      if (handle.cancelled) throw new CancelledError();

      handle.progress.download = {
        artifact: item.artifact.name,
        done: 0,
        total: item.artifact.size_in_bytes || 0,
      };
      const dl = await withError(
        downloadArtifactToTmp(api, item.artifact, signal, (downloaded, total) => {
          handle.progress.download = {
            artifact: item.artifact.name,
            done: downloaded,
            total: total > 0 ? total : item.artifact.size_in_bytes || 0,
          };
        })
      );
      handle.progress.download = undefined;
      if (dl.result) prefetched = dl.result;

      await finishUpload();

      if (dl.error || !prefetched) {
        if (dl.error && (handle.cancelled || dl.error.name === 'AbortError')) {
          throw new CancelledError();
        }
        recordFailure(item, 'download', dl.error ?? undefined);
        continue;
      }

      const matchArr = item.artifact.name.match(pattern) ?? [];
      const ctx = {
        env: item.envMatch,
        branch: item.headBranch,
        runDate: item.runDate,
        runId: item.workflowRunId,
        artifactName: item.artifact.name,
        repo: cfg.repo,
        workflowFile: cfg.workflow,
        workflowName: item.workflowName || cfg.workflow,
      };
      const project = renderTemplate(cfg.projectTemplate, ctx, Array.from(matchArr));
      const title = renderTemplate(cfg.titleTemplate, ctx, Array.from(matchArr));

      const downloaded = prefetched;
      prefetched = null;
      const uploadItem = item;
      handle.progress.current = i + 1;
      handle.progress.phase = 'uploading';
      handle.progress.upload = { artifact: uploadItem.artifact.name, done: 0, total: 0 };
      pendingUpload = withError(
        uploadArtifactFromTmp({
          tmpDir: downloaded.tmpDir,
          zipPath: downloaded.zipPath,
          artifact: uploadItem.artifact,
          syncConfigId: cfg.id,
          runId: uploadItem.workflowRunId,
          envMatch: uploadItem.envMatch,
          runDate: uploadItem.runDate,
          project,
          title,
          onUploadProgress: (completed, total) => {
            handle.progress.upload = { artifact: uploadItem.artifact.name, done: completed, total };
          },
        })
      ).then(({ error }) => ({
        ok: !error,
        item: uploadItem,
        error: error ?? undefined,
      }));
    }

    await finishUpload();
    handle.progress.download = undefined;
    handle.progress.upload = undefined;

    if (failed > 0) {
      outcome = uploaded > 0 ? 'partial' : 'failed';
      message = `uploaded ${uploaded}, failed ${failed}`;
    } else {
      message =
        toUpload.length === 0
          ? earlyExit
            ? `nothing new (${earlyExit})`
            : 'no matching artifacts found'
          : `uploaded ${uploaded}, failed ${failed}`;
    }
    if (failureNotes.length > 0) {
      message = `${message} (${failureNotes.join('; ')})`.slice(0, MAX_MESSAGE_LENGTH);
    }
  } catch (err) {
    if (err instanceof CancelledError || handle.cancelled) {
      outcome = 'cancelled';
      message = 'cancelled by user';
    } else {
      outcome = 'failed';
      const reason = err instanceof Error ? err.message : String(err);
      message =
        handle.progress.phase === 'scanning' && scanningRunId !== undefined
          ? `scanning run ${scanningRunId}: ${reason}`
          : reason;
      console.error(`[github-sync] ${cfg.name}: ${message}`);
    }
  } finally {
    if (pendingUpload) {
      const late = await pendingUpload;
      pendingUpload = null;
      if (late.ok) {
        uploaded++;
      } else if (late.error?.name !== 'AbortError') {
        // ponytail: cancel mid-upload aborts with AbortError - not a real failure, next sync replans it
        recordFailure(late.item, 'upload', late.error);
      }
    }
    if (prefetched) {
      await fs.rm(prefetched.tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
    running.delete(cfg.id);
    githubSyncDb.finishRun({
      id: runId,
      status: outcome,
      finishedAt: new Date().toISOString(),
      uploaded,
      skipped: skippedTotal,
      failed,
      message,
    });
    githubSyncDb.pruneRuns(cfg.id, {
      noopBefore: retentionCutoff(NOOP_RUN_RETENTION_DAYS),
      allBefore: retentionCutoff(RUN_RETENTION_DAYS),
    });
    githubSyncEvents.emitChanged();
    console.log(
      `[github-sync] ${cfg.name}: ${outcome} - uploaded=${uploaded} skipped=${skippedTotal} failed=${failed}`
    );
  }

  return {
    status: outcome,
    uploaded,
    skipped: skippedTotal,
    failed,
    message,
  };
}

async function downloadArtifactToTmp(
  api: GithubApiClient,
  artifact: GhArtifact,
  signal: AbortSignal,
  onProgress?: (downloaded: number, total: number) => void
): Promise<{ tmpDir: string; zipPath: string }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), TMP_DIR_PREFIX));
  const zipPath = path.join(tmpDir, `${artifact.id}.zip`);
  try {
    const writeStream = createWriteStream(zipPath);
    await api.downloadArtifactZip(artifact.id, writeStream, signal, onProgress);
    return { tmpDir, zipPath };
  } catch (err) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

async function uploadArtifactFromTmp(args: {
  tmpDir: string;
  zipPath: string;
  artifact: GhArtifact;
  syncConfigId: string;
  runId: string;
  envMatch: string;
  runDate: string;
  project: string;
  title: string;
  onUploadProgress?: (completed: number, total: number) => void;
}): Promise<void> {
  try {
    const reportId = randomUUID();
    const metadata = {
      project: args.project,
      title: args.title,
    };

    const { report } = await storage.uploadReportFromZipFile(
      reportId,
      args.zipPath,
      metadata,
      args.onUploadProgress
    );
    reportDb.onCreated(report);
    await processReportOrRollback(report);

    githubSyncDb.recordSyncedArtifact({
      artifactId: String(args.artifact.id),
      syncConfigId: args.syncConfigId,
      reportId,
      runId: args.runId,
      env: args.envMatch || null,
      runDate: args.runDate,
      uploadedAt: new Date().toISOString(),
    });
    githubSyncDb.clearFailedArtifact(String(args.artifact.id));

    const reportUrl = `${serveReportRoute}/${reportId}/index.html`;
    console.log(`[github-sync] uploaded artifact ${args.artifact.id} → ${reportUrl}`);
  } finally {
    await fs.rm(args.tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

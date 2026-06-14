import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SyncProgress } from '@playwright-reports/shared';
import { serveReportRoute } from '../constants.js';
import { githubSyncDb, reportDb } from '../service/db/index.js';
import { testManagementService } from '../service/test-management/index.js';
import { storage } from '../storage/index.js';
import { withError } from '../withError.js';
import type { GithubSyncConfigResolved } from './configService.js';
import { type GhArtifact, type GhWorkflowRun, GithubApiClient } from './githubApi.js';

const MAX_RUNS_PER_SCAN = 200;

interface ToUpload {
  artifact: GhArtifact;
  run: GhWorkflowRun;
  envMatch: string;
  runDate: string;
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
  status: 'success' | 'failed' | 'cancelled' | 'skipped';
  uploaded: number;
  skipped: number;
  failed: number;
  message?: string;
}

export function isRunning(configId: string): boolean {
  return running.has(configId);
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
  trigger: 'cron' | 'manual'
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

  const api = new GithubApiClient(cfg.repo, cfg.token);
  const signal = controller.signal;

  let uploaded = 0;
  let skippedExpired = 0;
  let skippedSynced = 0;
  let failed = 0;
  let earlyExit: string | undefined;
  let outcome: 'success' | 'failed' | 'cancelled' = 'success';
  let message: string | undefined;

  try {
    console.log(`[github-sync] ${cfg.name} (${cfg.repo}/${cfg.workflow}) starting [${trigger}]`);

    const runs = await api.listRunsSince({
      workflow: cfg.workflow,
      sinceISO: cfg.startDate,
      maxRuns: MAX_RUNS_PER_SCAN,
      signal,
    });

    const toUpload: ToUpload[] = [];

    for (const run of runs) {
      if (handle.cancelled) throw new CancelledError();

      const artifacts = await api.listArtifacts(run.id, signal);
      const matching = artifacts.filter((a) => pattern.test(a.name));
      if (matching.length === 0) continue;

      const alreadySynced = matching.some((a) => githubSyncDb.hasArtifact(String(a.id)));
      if (alreadySynced) {
        skippedSynced += matching.length;
        handle.progress.skipped = skippedSynced + skippedExpired;
        earlyExit = `artifact already synced in run ${run.id}`;
        break;
      }

      const allExpired = matching.every((a) => a.expired);
      if (allExpired) {
        skippedExpired += matching.length;
        handle.progress.skipped = skippedSynced + skippedExpired;
        earlyExit = `all artifacts expired in run ${run.id}`;
        break;
      }

      const fresh = matching.filter((a) => !a.expired);
      skippedExpired += matching.length - fresh.length;
      handle.progress.skipped = skippedSynced + skippedExpired;
      const runDate = run.created_at.slice(0, 10);
      for (const artifact of fresh) {
        const match = artifact.name.match(pattern);
        const envMatch = match?.[1] ?? '';
        toUpload.push({ artifact, run, envMatch, runDate });
      }
      handle.progress.total = toUpload.length;
    }

    toUpload.reverse();
    handle.progress.phase = 'uploading';
    handle.progress.total = toUpload.length;
    handle.progress.current = 0;
    handle.progress.currentArtifact = undefined;

    if (earlyExit) {
      console.log(`[github-sync] ${cfg.name}: early exit — ${earlyExit}`);
    }

    for (let i = 0; i < toUpload.length; i++) {
      const item = toUpload[i];
      if (handle.cancelled) throw new CancelledError();

      handle.progress.current = i + 1;
      handle.progress.currentArtifact = item.artifact.name;

      const matchArr = item.artifact.name.match(pattern) ?? [];
      const ctx = {
        env: item.envMatch,
        branch: item.run.head_branch ?? '',
        runDate: item.runDate,
        runId: String(item.run.id),
        artifactName: item.artifact.name,
        repo: cfg.repo,
        workflowFile: cfg.workflow,
        workflowName: item.run.name ?? cfg.workflow,
      };
      const project = renderTemplate(cfg.projectTemplate, ctx, Array.from(matchArr));
      const title = renderTemplate(cfg.titleTemplate, ctx, Array.from(matchArr));

      const { error: uploadErr } = await withError(
        uploadOneArtifact({
          api,
          artifact: item.artifact,
          signal,
          syncConfigId: cfg.id,
          runId: String(item.run.id),
          envMatch: item.envMatch,
          runDate: item.runDate,
          project,
          title,
        })
      );

      if (uploadErr) {
        if (handle.cancelled || uploadErr.name === 'AbortError') {
          throw new CancelledError();
        }
        failed++;
        handle.progress.failed = failed;
        console.error(
          `[github-sync] ${cfg.name}: artifact ${item.artifact.id} failed: ${uploadErr.message}`
        );
      } else {
        uploaded++;
        handle.progress.uploaded = uploaded;
      }
    }
    handle.progress.currentArtifact = undefined;

    if (failed > 0 && uploaded === 0) {
      outcome = 'failed';
      message = `${failed} artifact(s) failed to upload`;
    } else {
      message =
        toUpload.length === 0
          ? earlyExit
            ? `nothing new (${earlyExit})`
            : 'no matching artifacts found'
          : `uploaded ${uploaded}, failed ${failed}`;
    }
  } catch (err) {
    if (err instanceof CancelledError || handle.cancelled) {
      outcome = 'cancelled';
      message = 'cancelled by user';
    } else {
      outcome = 'failed';
      message = err instanceof Error ? err.message : String(err);
      console.error(`[github-sync] ${cfg.name}: ${message}`);
    }
  } finally {
    running.delete(cfg.id);
    githubSyncDb.finishRun({
      id: runId,
      status: outcome,
      finishedAt: new Date().toISOString(),
      uploaded,
      skipped: skippedSynced + skippedExpired,
      failed,
      message,
    });
    console.log(
      `[github-sync] ${cfg.name}: ${outcome} — uploaded=${uploaded} skipped=${
        skippedSynced + skippedExpired
      } failed=${failed}`
    );
  }

  return {
    status: outcome,
    uploaded,
    skipped: skippedSynced + skippedExpired,
    failed,
    message,
  };
}

async function uploadOneArtifact(args: {
  api: GithubApiClient;
  artifact: GhArtifact;
  signal: AbortSignal;
  syncConfigId: string;
  runId: string;
  envMatch: string;
  runDate: string;
  project: string;
  title: string;
}): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gh-sync-'));
  const zipPath = path.join(tmpDir, `${args.artifact.id}.zip`);

  try {
    const writeStream = createWriteStream(zipPath);
    await args.api.downloadArtifactZip(args.artifact.id, writeStream, args.signal);

    const reportId = randomUUID();
    const metadata = {
      project: args.project,
      title: args.title,
    };

    const { report } = await storage.uploadReportFromZipFile(reportId, zipPath, metadata);
    reportDb.onCreated(report);

    const { error: testsErr } = await withError(testManagementService.processReport(report));
    if (testsErr) {
      console.error(
        `[github-sync] processReport failed for ${reportId}: ${testsErr instanceof Error ? testsErr.message : String(testsErr)}`
      );
    }

    githubSyncDb.recordSyncedArtifact({
      artifactId: String(args.artifact.id),
      syncConfigId: args.syncConfigId,
      reportId,
      runId: args.runId,
      env: args.envMatch || null,
      runDate: args.runDate,
      uploadedAt: new Date().toISOString(),
    });

    const reportUrl = `${serveReportRoute}/${reportId}/index.html`;
    console.log(`[github-sync] uploaded artifact ${args.artifact.id} → ${reportUrl}`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

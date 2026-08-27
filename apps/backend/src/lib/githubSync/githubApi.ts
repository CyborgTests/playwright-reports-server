import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';

export interface GhWorkflowRun {
  id: number;
  name: string | null;
  created_at: string;
  head_branch: string | null;
  conclusion: string | null;
  status: string | null;
}

export interface GhArtifact {
  id: number;
  name: string;
  expired: boolean;
  created_at: string;
  size_in_bytes: number;
}

interface GhRunsResponse {
  total_count: number;
  workflow_runs: GhWorkflowRun[];
}

interface GhArtifactsResponse {
  artifacts: GhArtifact[];
}

const ARTIFACTS_PER_PAGE = 100;

const API_BASE = 'https://api.github.com';

const MAX_ATTEMPTS = 3;
const JSON_TIMEOUT_MS = 30_000;
const DOWNLOAD_HEADERS_TIMEOUT_MS = 60_000;
const DOWNLOAD_STALL_TIMEOUT_MS = 60_000;
const MAX_RATE_LIMIT_WAIT_MS = 60_000;

function backoffMs(attempt: number): number {
  return 4 ** (attempt - 1) * 1000 * (0.75 + Math.random() * 0.5);
}

export class GithubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'GithubApiError';
  }
}

export class GithubApiClient {
  constructor(
    private readonly repo: string,
    private readonly token: string | undefined
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'playwright-reports-server',
    };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  private retryDelayFor(res: Response, attempt: number): number | null {
    if (res.status >= 500) return backoffMs(attempt);
    if (res.status !== 403 && res.status !== 429) return null;

    const retryAfterHeader = res.headers.get('retry-after');
    if (retryAfterHeader !== null) {
      const retryAfterMs = Number(retryAfterHeader) * 1000;
      if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
        return retryAfterMs > MAX_RATE_LIMIT_WAIT_MS ? null : retryAfterMs;
      }
    }
    if (res.headers.get('x-ratelimit-remaining') !== '0') return null;

    const reset = Number(res.headers.get('x-ratelimit-reset'));
    if (!Number.isFinite(reset) || reset <= 0) return backoffMs(attempt);
    const waitMs = reset * 1000 - Date.now();
    if (waitMs <= 0) return 0;
    return waitMs > MAX_RATE_LIMIT_WAIT_MS ? null : waitMs;
  }

  private async requestWithRetry(
    url: string,
    options: { timeoutMs: number; callerSignal?: AbortSignal; timeoutCoversBody: boolean }
  ): Promise<Response> {
    const { timeoutMs, callerSignal, timeoutCoversBody } = options;
    let lastNetworkError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const headerTimeout = timeoutCoversBody ? undefined : new AbortController();
      const timer = headerTimeout
        ? setTimeout(
            () => headerTimeout.abort(new DOMException('request timed out', 'TimeoutError')),
            timeoutMs
          )
        : undefined;
      const timeoutSignal = headerTimeout ? headerTimeout.signal : AbortSignal.timeout(timeoutMs);
      const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;

      let res: Response;
      try {
        res = await fetch(url, { headers: this.headers(), redirect: 'follow', signal });
      } catch (error) {
        if (callerSignal?.aborted) throw error;
        lastNetworkError = error instanceof Error ? error : new Error(String(error));
        if (attempt === MAX_ATTEMPTS) throw lastNetworkError;
        await sleep(backoffMs(attempt), undefined, { signal: callerSignal });
        continue;
      } finally {
        if (timer) clearTimeout(timer);
      }

      if (res.ok) return res;

      const retryDelay = attempt === MAX_ATTEMPTS ? null : this.retryDelayFor(res, attempt);
      const text = await res.text().catch(() => '');
      if (retryDelay === null) {
        throw new GithubApiError(res.status, `GitHub ${res.status}: ${text || res.statusText}`);
      }
      await sleep(retryDelay, undefined, { signal: callerSignal });
    }

    throw lastNetworkError ?? new Error('GitHub request exhausted retries');
  }

  private async json<T>(url: string, signal?: AbortSignal): Promise<T> {
    const res = await this.requestWithRetry(url, {
      timeoutMs: JSON_TIMEOUT_MS,
      callerSignal: signal,
      timeoutCoversBody: true,
    });
    return (await res.json()) as T;
  }

  public async listRunsSince(args: {
    workflow: string;
    sinceISO: string;
    maxRuns: number;
    signal?: AbortSignal;
  }): Promise<GhWorkflowRun[]> {
    const runs: GhWorkflowRun[] = [];
    let page = 1;
    while (runs.length < args.maxRuns) {
      const perPage = Math.min(100, args.maxRuns - runs.length);
      const url =
        `${API_BASE}/repos/${this.repo}/actions/workflows/${encodeURIComponent(args.workflow)}` +
        `/runs?status=completed&per_page=${perPage}&page=${page}`;
      const data = await this.json<GhRunsResponse>(url, args.signal);
      const batch = data.workflow_runs ?? [];
      if (batch.length === 0) break;
      let reachedCutoff = false;
      for (const run of batch) {
        if (run.created_at < args.sinceISO) {
          reachedCutoff = true;
          break;
        }
        runs.push(run);
      }
      if (reachedCutoff || batch.length < perPage) break;
      page++;
    }
    return runs;
  }

  public async listArtifacts(runId: number | string, signal?: AbortSignal): Promise<GhArtifact[]> {
    const artifacts: GhArtifact[] = [];
    for (let page = 1; ; page++) {
      const data = await this.json<GhArtifactsResponse>(
        `${API_BASE}/repos/${this.repo}/actions/runs/${runId}/artifacts` +
          `?per_page=${ARTIFACTS_PER_PAGE}&page=${page}`,
        signal
      );
      const batch = data.artifacts ?? [];
      artifacts.push(...batch);
      if (batch.length < ARTIFACTS_PER_PAGE) return artifacts;
    }
  }

  public async downloadArtifactZip(
    artifactId: number | string,
    writable: NodeJS.WritableStream,
    signal?: AbortSignal,
    onProgress?: (downloaded: number, total: number) => void
  ): Promise<void> {
    const url = `${API_BASE}/repos/${this.repo}/actions/artifacts/${artifactId}/zip`;
    const res = await this.requestWithRetry(url, {
      timeoutMs: DOWNLOAD_HEADERS_TIMEOUT_MS,
      callerSignal: signal,
      timeoutCoversBody: false,
    });
    if (!res.body) throw new Error('GitHub artifact download: empty body');

    const total = Number(res.headers.get('content-length') ?? '0') || 0;
    let downloaded = 0;
    const stalled = new AbortController();
    const stallTimer = setTimeout(
      () => stalled.abort(new DOMException('download stalled', 'TimeoutError')),
      DOWNLOAD_STALL_TIMEOUT_MS
    );
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        stallTimer.refresh();
        downloaded += chunk.length;
        onProgress?.(downloaded, total);
        cb(null, chunk);
      },
    });

    try {
      await pipeline(Readable.fromWeb(res.body as never), counter, writable, {
        signal: stalled.signal,
      });
    } catch (error) {
      if (stalled.signal.aborted && !signal?.aborted) {
        throw new Error(
          `GitHub artifact download stalled: no data for ${
            DOWNLOAD_STALL_TIMEOUT_MS / 1000
          }s after ${downloaded} of ${total || 'unknown'} bytes`
        );
      }
      throw error;
    } finally {
      clearTimeout(stallTimer);
    }
  }
}

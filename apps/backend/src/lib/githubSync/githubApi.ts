import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

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

const API_BASE = 'https://api.github.com';

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

  private async json<T>(url: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(url, { headers: this.headers(), signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new GithubApiError(res.status, `GitHub ${res.status}: ${text || res.statusText}`);
    }
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
    const data = await this.json<GhArtifactsResponse>(
      `${API_BASE}/repos/${this.repo}/actions/runs/${runId}/artifacts?per_page=100`,
      signal
    );
    return data.artifacts ?? [];
  }

  public async downloadArtifactZip(
    artifactId: number | string,
    writable: NodeJS.WritableStream,
    signal?: AbortSignal
  ): Promise<void> {
    const url = `${API_BASE}/repos/${this.repo}/actions/artifacts/${artifactId}/zip`;
    const res = await fetch(url, {
      headers: this.headers(),
      redirect: 'follow',
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new GithubApiError(res.status, `GitHub ${res.status}: ${text || res.statusText}`);
    }
    if (!res.body) throw new Error('GitHub artifact download: empty body');

    await pipeline(Readable.fromWeb(res.body as never), writable);
  }
}

import { setTimeout as sleep } from 'node:timers/promises';
import type { DiscoveredModel } from '@playwright-reports/shared';
import { parseCursorModels } from '../discovery.js';
import type {
  LLMProviderConfig,
  LLMRequest,
  LLMResponse,
  SegmentedPrompt,
} from '../types/index.js';
import { LLMProviderError } from '../types/index.js';
import { LLMProvider, type ProbeResult } from './base.js';

/** Cursor accepts at most 5 images per prompt. */
const MAX_IMAGES = 5;
const ACTIVE_RUN_STATUSES = new Set(['CREATING', 'RUNNING', 'WAITING_FOR_BACKGROUND_WORK']);

interface CursorRun {
  id: string;
  status: string;
  result?: string;
}

/** Accepts `https://api.cursor.com` or `https://api.cursor.com/v1`. */
export function normalizeCursorBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

/**
 * Cursor Cloud Agents API (https://cursor.com/docs/cloud-agent/api/endpoints).
 * There is no chat-completions endpoint, so one request = one no-repo agent:
 * POST /v1/agents, poll the run until it ends, read `run.result`, delete the agent.
 */
export class CursorProvider extends LLMProvider {
  /** Poll interval for run status. Static so tests can set it to 0. */
  static pollIntervalMs = 5_000;

  constructor(config: LLMProviderConfig) {
    super({ ...config, baseUrl: normalizeCursorBaseUrl(config.baseUrl) });
  }

  protected getApiEndpoint(): string {
    return `${this.config.baseUrl}/v1/agents`;
  }

  protected getModelsEndpoint(): string {
    return `${this.config.baseUrl}/v1/models`;
  }

  protected getDefaultHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.config.apiKey}` };
  }

  /** GET /v1/me: proves the key is valid without starting an agent. */
  async validateConfig(): Promise<boolean> {
    try {
      const response = await this.withTimeout(
        (signal) => fetch(`${this.config.baseUrl}/v1/me`, { headers: this.getHeaders(), signal }),
        5000
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /** The model id must be in the Cloud Agents catalog. Empty = Cursor's default model. */
  async probe(model: string | undefined): Promise<ProbeResult> {
    if (!model) return { ok: true };
    const ids = await this.getAvailableModels();
    if (ids.includes(model)) return { ok: true };
    return {
      ok: false,
      error: `Cursor does not list model "${model}" in GET /v1/models. Use Import models to pick a valid id.`,
    };
  }

  async sendSegmentedMessage(prompt: SegmentedPrompt): Promise<LLMResponse> {
    const images = prompt.segments
      .flatMap((s) => s.images ?? [])
      .slice(0, MAX_IMAGES)
      .map((img) => ({ data: img.data, mimeType: img.mediaType }));
    const body = {
      prompt: {
        text: prompt.segments.map((s) => s.content).join('\n\n'),
        ...(images.length > 0 ? { images } : {}),
      },
      ...(this.config.model ? { model: { id: this.config.model } } : {}),
    };

    const run = await this.withTimeout(async (signal) => {
      const created = await this.call<{ agent: { id: string }; run: CursorRun }>(
        'POST',
        '/v1/agents',
        signal,
        body
      );
      const agentId = created.agent.id;
      try {
        let current = created.run;
        while (ACTIVE_RUN_STATUSES.has(current.status)) {
          await sleep(CursorProvider.pollIntervalMs, undefined, { signal });
          current = await this.call<CursorRun>(
            'GET',
            `/v1/agents/${agentId}/runs/${current.id}`,
            signal
          );
        }
        return current;
      } finally {
        // One agent per request: remove it even on timeout/cancel. Best effort.
        fetch(`${this.config.baseUrl}/v1/agents/${agentId}`, {
          method: 'DELETE',
          headers: this.getHeaders(),
        }).catch(() => undefined);
      }
    });

    if (run.status !== 'FINISHED' || !run.result) {
      throw new LLMProviderError(
        `Cursor agent run ended with status ${run.status} and no result`,
        'server_error'
      );
    }
    // The run payload has no token usage; estimate like the OpenAI path.
    const inputTokens = this.estimateLocalTokens(prompt);
    const outputTokens = this.estimateTokensFromText(run.result);
    return {
      content: run.result,
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      model: this.config.model || 'cursor-default',
      finishReason: 'stop',
    };
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    signal: AbortSignal,
    body?: unknown
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: this.getHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new LLMProviderError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
        'network'
      );
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw this.handleError({
        status: response.status,
        statusText: response.statusText,
        message: text || response.statusText,
      });
    }
    return (await response.json()) as T;
  }

  protected formatRequestBody(_request: LLMRequest): unknown {
    throw new Error('CursorProvider builds its own request in sendSegmentedMessage');
  }

  protected async parseResponse(_response: Response): Promise<LLMResponse> {
    throw new Error('CursorProvider parses its own response in sendSegmentedMessage');
  }

  protected extractModelIds(data: unknown): string[] {
    return parseCursorModels(data).map((m) => m.id);
  }

  protected parseDiscoveredModels(data: unknown): DiscoveredModel[] {
    return parseCursorModels(data);
  }
}

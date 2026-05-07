import { withError } from '../../withError.js';
import type {
  LLMRequest,
  LLMResponse,
  LLMResponseSchema,
  LLMStreamChunk,
  SegmentedPrompt,
} from '../types/index.js';
import { BaseLLMProvider as BaseProvider, LLMProviderError } from '../types/index.js';

export interface SendOptions {
  temperature?: number;
  maxTokens?: number;
  responseSchema?: LLMResponseSchema;
}

/** Cached value with absolute expiry timestamp (ms since epoch). */
interface CachedValue<T> {
  value: T;
  expiresAt: number;
}

const CONTEXT_WINDOW_CACHE_TTL_MS = 5 * 60 * 1000;

export abstract class LLMProvider extends BaseProvider {
  protected abstract getApiEndpoint(): string;
  protected abstract getStreamApiEndpoint(): string;
  protected abstract getModelsEndpoint(): string;
  protected abstract getDefaultHeaders(): Record<string, string>;

  private contextWindowCache: CachedValue<number | null> | null = null;

  /**
   * Resolved context window (in tokens) for the active model. Order:
   * 1. Manual override on config.contextWindow (always wins).
   * 2. Provider-specific detection (Anthropic registry / OpenAI /models probe).
   * 3. null if undetectable — callers should fall back to a safe default.
   * Cached for 5 min to avoid hammering /models on every preflight.
   */
  async getContextWindow(): Promise<number | null> {
    if (this.config.contextWindow && this.config.contextWindow > 0) {
      return this.config.contextWindow;
    }
    const now = Date.now();
    if (this.contextWindowCache && this.contextWindowCache.expiresAt > now) {
      return this.contextWindowCache.value;
    }
    let value: number | null = null;
    try {
      value = await this.detectContextWindow();
    } catch (err) {
      console.warn(
        `[llm] context window detection failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    this.contextWindowCache = { value, expiresAt: now + CONTEXT_WINDOW_CACHE_TTL_MS };
    return value;
  }

  /** Provider-specific context window detection. Default: null (unknown). */
  protected async detectContextWindow(): Promise<number | null> {
    return null;
  }

  /**
   * Count tokens for a segmented prompt. Default implementation: 4-chars-per-
   * token approximation. Anthropic overrides with /messages/count_tokens for
   * an exact value.
   */
  async countTokens(prompt: SegmentedPrompt): Promise<number> {
    return (
      this.estimateTokensFromText(this.serializeSegmentsForCounting(prompt)) +
      this.estimateTokensFromImages(prompt)
    );
  }

  /** Default approximate counter: ~4 chars per token (English). Off by ~10%. */
  protected estimateTokensFromText(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /** Concatenate all segment content for counting; matches what the provider
   *  will send in spirit (not exact bytes, since each provider serializes
   *  differently — but close enough for budget gating). */
  protected serializeSegmentsForCounting(prompt: SegmentedPrompt): string {
    return prompt.segments.map((s) => s.content).join('\n\n');
  }

  /** Conservative per-image token estimate. Real cost depends on dimensions
   *  and model (Claude ~1500/img, GPT-4o ~85-700/img). Used by the default
   *  estimator; Anthropic overrides countTokens with the exact API. */
  protected estimateTokensFromImages(prompt: SegmentedPrompt): number {
    const imageCount = prompt.segments.reduce(
      (sum, s) => sum + (s.images ? s.images.length : 0),
      0
    );
    return imageCount * 1200;
  }

  async sendMessageStream(
    prompt: string,
    onChunk: (chunk: LLMStreamChunk) => void,
    systemPrompt?: string
  ): Promise<void> {
    const modelToUse = await this.resolveModelForStream(onChunk);
    if (!modelToUse) return;

    const request = this.createRequest(prompt, systemPrompt, modelToUse);
    return this.executeStream(request, onChunk);
  }

  async sendMessage(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    const modelToUse = await this.resolveModelOrThrow();
    const request = this.createRequest(prompt, systemPrompt, modelToUse);
    return this.executeRequest(request);
  }

  async sendSegmentedMessage(
    prompt: SegmentedPrompt,
    options: SendOptions = {}
  ): Promise<LLMResponse> {
    const modelToUse = await this.resolveModelOrThrow();
    const request = this.createSegmentedRequest(prompt, modelToUse, options);
    return this.executeRequest(request);
  }

  async sendSegmentedMessageStream(
    prompt: SegmentedPrompt,
    onChunk: (chunk: LLMStreamChunk) => void,
    options: SendOptions = {}
  ): Promise<void> {
    const modelToUse = await this.resolveModelForStream(onChunk);
    if (!modelToUse) return;

    const request = this.createSegmentedRequest(prompt, modelToUse, options);
    return this.executeStream(request, onChunk);
  }

  private async resolveModelOrThrow(): Promise<string> {
    if (this.config.model) return this.config.model;
    const bestModel = await this.getBestAvailableModel();
    if (!bestModel) {
      throw new Error('No model configured and no suitable models found');
    }
    return bestModel;
  }

  private async resolveModelForStream(
    onChunk: (chunk: LLMStreamChunk) => void
  ): Promise<string | null> {
    if (this.config.model) return this.config.model;
    const bestModel = await this.getBestAvailableModel();
    if (!bestModel) {
      onChunk({ type: 'error', error: 'No model configured and no suitable models found' });
      return null;
    }
    return bestModel;
  }

  private async executeRequest(request: LLMRequest): Promise<LLMResponse> {
    return this.retryRequest(async () => {
      const response = await this.withTimeout(this.sendRequest(request));

      if (!response.ok) {
        let errorBody = '';
        try {
          errorBody = await response.text();
        } catch {
          // ignore
        }
        console.error(`[llm] Request failed ${response.status}: ${errorBody.substring(0, 500)}`);
        throw this.handleError({
          status: response.status,
          statusText: response.statusText,
          message: errorBody || response.statusText,
        });
      }

      return this.parseResponse(response, request);
    });
  }

  private async executeStream(
    request: LLMRequest,
    onChunk: (chunk: LLMStreamChunk) => void
  ): Promise<void> {
    return this.retryRequest(async () => {
      const response = await this.withTimeout(this.sendStreamRequest(request));
      return this.processStream(response, onChunk);
    });
  }

  protected createSegmentedRequest(
    prompt: SegmentedPrompt,
    model: string,
    options: SendOptions
  ): LLMRequest {
    return {
      model,
      messages: [],
      segments: prompt.segments,
      temperature: options.temperature ?? this.config.temperature,
      maxTokens: options.maxTokens ?? this.config.maxTokens,
      responseSchema: options.responseSchema,
    };
  }

  async validateConfig(): Promise<boolean> {
    try {
      const response = await this.withTimeout(
        fetch(this.getModelsEndpoint(), {
          method: 'GET',
          headers: this.getHeaders(),
        }),
        5000
      );

      return response.ok;
    } catch (error) {
      console.warn(
        `[llm] validation failed for ${this.config.provider}:`,
        error instanceof Error ? error.message : error
      );
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await this.withTimeout(
        fetch(this.getModelsEndpoint(), {
          method: 'GET',
          headers: this.getHeaders(),
        })
      );

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return this.extractModelIds(data);
    } catch {
      // fallback to returning the configured model if available
      return this.config.model ? [this.config.model] : [];
    }
  }

  protected createRequest(prompt: string, systemPrompt?: string, model?: string): LLMRequest {
    const messages = [];

    if (systemPrompt) {
      messages.push({ role: 'system' as const, content: systemPrompt });
    }

    messages.push({ role: 'user' as const, content: prompt });

    return {
      model: model ?? this.config.model,
      messages,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    };
  }

  protected async sendRequest(request: LLMRequest): Promise<Response> {
    const { result, error } = await withError(
      fetch(this.getApiEndpoint(), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(this.formatRequestBody(request)),
      })
    );

    if (error) {
      throw new LLMProviderError(`Network error: ${error.message}`, 'network');
    }

    if (!result) {
      throw new LLMProviderError('No response received', 'network');
    }
    return result;
  }

  protected async sendStreamRequest(request: LLMRequest): Promise<Response> {
    const streamHeaders = {
      ...this.getHeaders(),
    };

    const { result, error } = await withError(
      fetch(this.getStreamApiEndpoint(), {
        method: 'POST',
        headers: streamHeaders,
        body: JSON.stringify(this.formatStreamRequestBody(request)),
      })
    );

    if (error) {
      throw new LLMProviderError(`Network error: ${error.message}`, 'network');
    }

    if (!result) {
      throw new LLMProviderError('No response received', 'network');
    }
    return result;
  }

  protected getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...this.getDefaultHeaders(),
    };
  }

  protected abstract formatRequestBody(request: LLMRequest): unknown;
  protected abstract formatStreamRequestBody(request: LLMRequest): unknown;
  protected abstract extractModelIds(data: unknown): string[];

  protected async getBestAvailableModel(): Promise<string | null> {
    try {
      const availableModels = await this.getAvailableModels();
      if (availableModels.length === 0) {
        return null;
      }

      return availableModels[0];
    } catch (error) {
      console.warn(
        `Failed to get available models: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      return null;
    }
  }

  protected handleError(error: {
    status?: number;
    statusCode?: number;
    message?: string;
    statusText?: string;
    code?: string;
  }): LLMProviderError {
    const statusCode = error.status || error.statusCode;

    if (statusCode === 401 || statusCode === 403) {
      return new LLMProviderError(
        error.message ?? error.statusText ?? 'Authentication failed',
        'authentication',
        statusCode
      );
    }

    if (statusCode === 429) {
      return new LLMProviderError(
        'Rate limit exceeded. Please try again later.',
        'rate_limit',
        statusCode
      );
    }

    if (statusCode === 400) {
      return new LLMProviderError(
        `Invalid request: ${error.message || error.statusText}`,
        'invalid_request',
        statusCode
      );
    }

    if (statusCode && statusCode >= 500) {
      return new LLMProviderError(
        `Server error: ${error.message || error.statusText}`,
        'server_error',
        statusCode
      );
    }

    if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
      return new LLMProviderError(`Network error: ${error.message}`, 'network');
    }

    return new LLMProviderError(
      `Unexpected error: ${error.message || error.statusText}`,
      'server_error',
      statusCode
    );
  }
}

import type { DiscoveredModel } from '@playwright-reports/shared';
import { withProbeSlot } from './probeThrottle.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider } from './providers/openai.js';
import type {
  LLMProviderConfig,
  LLMResponse,
  MultimodalMode,
  SegmentedPrompt,
} from './types/index.js';
import { LLMProviderError } from './types/index.js';

export interface SegmentedSendOptions {
  temperature?: number;
  maxTokens?: number;
}

const MULTIMODAL_BLOCKLIST_TTL_MS = 60 * 60 * 1000;

export class LLMService {
  private static instance: LLMService;
  private provider: OpenAIProvider | AnthropicProvider | null = null;
  private config: LLMProviderConfig | null = null;
  private multimodalBlocklist = new Map<string, number>();

  private constructor() {
    this.config = {
      provider: 'openai',
      baseUrl: '',
      apiKey: '',
      model: '',
      requestTimeoutMs: 5 * 60 * 1000,
      maxRetries: 3,
      retryDelayMs: 1 * 1000,
    };
  }

  static getInstance(): LLMService {
    if (!LLMService.instance) {
      LLMService.instance = new LLMService();
    }
    return LLMService.instance;
  }

  isConfigured(): boolean {
    return !!this.config?.baseUrl;
  }

  getBaseUrl(): string | null {
    return this.config?.baseUrl ?? null;
  }

  estimateLocalInputTokens(prompt: SegmentedPrompt): number {
    if (!this.provider) return 0;
    return this.provider.estimateLocalTokens(prompt);
  }

  async initialize(): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('LLM service is not enabled. Configure the base URL in Settings → LLM.');
    }

    if (!this.provider) {
      this.provider = this.createProvider();
      await this.provider.validateConfig();
    }
  }

  /** Resolve the effective image-attachment shape for a segmented call. */
  private resolveCallShape(prompt: SegmentedPrompt): {
    imagesMode: MultimodalMode;
    useImages: boolean;
  } {
    const imagesMode = (this.config?.multimodalMode ?? 'auto') as MultimodalMode;
    const useImages =
      this.promptHasImages(prompt) && imagesMode !== 'disabled' && !this.isMultimodalBlocked();
    return { imagesMode, useImages };
  }

  private stripImages(prompt: SegmentedPrompt): SegmentedPrompt {
    return { segments: prompt.segments.map((s) => ({ ...s, images: undefined })) };
  }

  async sendSegmentedMessage(
    prompt: SegmentedPrompt,
    options: SegmentedSendOptions = {}
  ): Promise<LLMResponse> {
    if (!this.provider) {
      throw new Error('LLM provider not initialized');
    }

    const initial = this.resolveCallShape(prompt);
    const { imagesMode } = initial;
    let { useImages } = initial;

    const buildPrompt = (): SegmentedPrompt => (useImages ? prompt : this.stripImages(prompt));

    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.provider.sendSegmentedMessage(buildPrompt(), options);
      } catch (err) {
        lastErr = err;
        if (useImages && imagesMode !== 'force' && this.isMultimodalUnsupportedError(err)) {
          this.markMultimodalBlocked();
          console.warn(
            `[llm] multimodal unsupported by ${this.providerKey()} - retrying without images`
          );
          useImages = false;
          continue;
        }
        throw err;
      }
    }
    throw lastErr ?? new Error('sendSegmentedMessage exhausted retries');
  }

  async sendViaModel(
    connection: Pick<
      LLMProviderConfig,
      'provider' | 'baseUrl' | 'apiKey' | 'model' | 'maxTokens' | 'contextWindow' | 'multimodalMode'
    >,
    prompt: SegmentedPrompt,
    options: SegmentedSendOptions = {}
  ): Promise<LLMResponse> {
    const merged: LLMProviderConfig = {
      provider: connection.provider,
      baseUrl: connection.baseUrl,
      apiKey: connection.apiKey,
      model: connection.model,
      maxTokens: connection.maxTokens,
      contextWindow: connection.contextWindow,
      multimodalMode: connection.multimodalMode,
      requestTimeoutMs: this.config?.requestTimeoutMs ?? 5 * 60 * 1000,
      maxRetries: this.config?.maxRetries ?? 3,
      retryDelayMs: this.config?.retryDelayMs ?? 1000,
    };
    const provider =
      merged.provider === 'anthropic' ? new AnthropicProvider(merged) : new OpenAIProvider(merged);
    const finalPrompt = merged.multimodalMode === 'disabled' ? this.stripImages(prompt) : prompt;
    return provider.sendSegmentedMessage(finalPrompt, options);
  }

  private promptHasImages(prompt: SegmentedPrompt): boolean {
    return prompt.segments.some((s) => s.images && s.images.length > 0);
  }

  private providerKey(): string {
    return this.getProviderKey();
  }

  public getProviderKey(): string {
    const c = this.config;
    return `${c?.provider}:${c?.baseUrl}:${c?.model || '<auto>'}`;
  }

  private isMultimodalBlocked(): boolean {
    const expiresAt = this.multimodalBlocklist.get(this.providerKey());
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
      this.multimodalBlocklist.delete(this.providerKey());
      return false;
    }
    return true;
  }

  private markMultimodalBlocked(): void {
    this.multimodalBlocklist.set(this.providerKey(), Date.now() + MULTIMODAL_BLOCKLIST_TTL_MS);
  }

  private isMultimodalUnsupportedError(err: unknown): boolean {
    if (!(err instanceof LLMProviderError)) return false;
    if (err.code !== 'invalid_request') return false;
    const msg = err.message.toLowerCase();
    const featureNamed =
      msg.includes('image_url') ||
      msg.includes('multimodal') ||
      /\b(image|images|vision)\b/.test(msg);
    if (!featureNamed) return false;
    return (
      msg.includes('not supported') ||
      msg.includes('unsupported') ||
      msg.includes('does not support') ||
      msg.includes("doesn't support") ||
      msg.includes('does not accept') ||
      msg.includes('not a vision model')
    );
  }

  async getContextWindow(): Promise<number | null> {
    if (!this.provider) {
      throw new Error('LLM provider not initialized');
    }
    return this.provider.getContextWindow();
  }

  async countTokens(prompt: SegmentedPrompt): Promise<number> {
    if (!this.provider) {
      throw new Error('LLM provider not initialized');
    }
    return this.provider.countTokens(prompt);
  }

  private createProvider(): OpenAIProvider | AnthropicProvider {
    if (!this.config) {
      throw new Error('LLM config not initialized');
    }

    switch (this.config.provider) {
      case 'openai':
        return new OpenAIProvider(this.config);
      case 'anthropic':
        return new AnthropicProvider(this.config);
      default:
        throw new Error(`Unknown LLM provider: ${this.config.provider}`);
    }
  }

  getConfig(): Omit<LLMProviderConfig, 'apiKey'> | Record<string, never> {
    if (!this.config || !this.isConfigured()) {
      return {};
    }

    const { apiKey: _apiKey, ...safeConfig } = this.config;
    return safeConfig;
  }

  applyConfig(config?: Partial<LLMProviderConfig>): void {
    if (!config) return;
    this.config = {
      ...this.config,
      ...config,
    } as LLMProviderConfig;
    this.provider = null;
  }

  clearConfig(): void {
    this.applyConfig({ provider: 'openai', baseUrl: '', apiKey: '', model: '' });
  }

  async restart(config?: Partial<LLMProviderConfig>): Promise<void> {
    this.applyConfig(config);
    if (this.isConfigured()) {
      await this.initialize();
    }
  }

  async discoverModels(
    overrides: Pick<LLMProviderConfig, 'provider' | 'baseUrl'> & { apiKey?: string }
  ): Promise<{ success: boolean; error?: string; models?: DiscoveredModel[] }> {
    if (!overrides.baseUrl) return { success: false, error: 'Base URL is required' };

    const config: LLMProviderConfig = {
      provider: overrides.provider,
      baseUrl: overrides.baseUrl,
      apiKey: overrides.apiKey ?? '',
      model: '',
      requestTimeoutMs: this.config?.requestTimeoutMs ?? 60_000,
      maxRetries: 0,
      retryDelayMs: 0,
    };

    try {
      const provider =
        config.provider === 'anthropic'
          ? new AnthropicProvider(config)
          : new OpenAIProvider(config);
      const models = await withProbeSlot(config.baseUrl, () => provider.discoverModels());
      return { success: true, models };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Model discovery failed',
      };
    }
  }

  async testConnection(
    overrides?: Partial<LLMProviderConfig>
  ): Promise<{ success: boolean; error?: string; models?: string[] }> {
    const merged: LLMProviderConfig = {
      provider: overrides?.provider ?? this.config?.provider ?? 'openai',
      baseUrl: overrides?.baseUrl ?? this.config?.baseUrl ?? '',
      apiKey: overrides?.apiKey ?? this.config?.apiKey ?? '',
      model: overrides?.model ?? this.config?.model ?? '',
      temperature: overrides?.temperature ?? this.config?.temperature ?? 0.3,
      requestTimeoutMs: this.config?.requestTimeoutMs ?? 60_000,
      maxRetries: 0,
      retryDelayMs: 0,
    };

    if (!merged.baseUrl) {
      return { success: false, error: 'Base URL is required' };
    }

    let provider: OpenAIProvider | AnthropicProvider;
    try {
      switch (merged.provider) {
        case 'openai':
          provider = new OpenAIProvider(merged);
          break;
        case 'anthropic':
          provider = new AnthropicProvider(merged);
          break;
        default:
          return { success: false, error: `Unknown provider: ${merged.provider}` };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to initialize provider',
      };
    }

    try {
      return await withProbeSlot(merged.baseUrl, async () => {
        const ok = await provider.validateConfig();
        if (!ok) {
          return {
            success: false,
            error:
              'Provider rejected the request. Check the base URL and API key (the /models endpoint must be reachable).',
          };
        }
        // Skip the /models GET when a model is already named - the probe covers it.
        const models = merged.model ? [] : await provider.getAvailableModels();
        if (merged.provider === 'openai') {
          const probe = await this.probeOpenAIChatCompletions(merged, models);
          if (!probe.ok) {
            return { success: false, error: probe.error };
          }
        }
        return { success: true, models };
      });
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Connection test failed',
      };
    }
  }

  private async probeOpenAIChatCompletions(
    merged: LLMProviderConfig,
    knownModels: string[]
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const model = merged.model || knownModels[0];
    if (!model) {
      return {
        ok: false,
        error: 'No model available to verify the chat completions endpoint.',
      };
    }

    const url = `${merged.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (merged.apiKey) headers.Authorization = `Bearer ${merged.apiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          temperature: 0,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Could not reach /chat/completions: ${message}` };
    } finally {
      clearTimeout(timeout);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null;
    }

    if (!response.ok) {
      const errorObj =
        body && typeof body === 'object' && 'error' in body
          ? (body as { error: unknown }).error
          : null;
      const looksOpenAI =
        errorObj !== null &&
        typeof errorObj === 'object' &&
        ('message' in (errorObj as object) || 'type' in (errorObj as object));
      if (looksOpenAI) return { ok: true };

      return {
        ok: false,
        error: `Server responded ${response.status} at /chat/completions but the body is not in OpenAI format. Check that the base URL points to an OpenAI-compatible endpoint (typically ending in /v1).`,
      };
    }

    const choices =
      body && typeof body === 'object' && 'choices' in body
        ? (body as { choices: unknown }).choices
        : null;
    const firstChoice = Array.isArray(choices) ? (choices[0] as Record<string, unknown>) : null;
    const looksValid = !!(
      firstChoice &&
      typeof firstChoice === 'object' &&
      'message' in firstChoice
    );
    if (!looksValid) {
      return {
        ok: false,
        error:
          'The /chat/completions response is not in OpenAI format. Confirm the base URL points to an OpenAI-compatible API (typically ending in /v1).',
      };
    }

    return { ok: true };
  }
}

export const llmService = LLMService.getInstance();

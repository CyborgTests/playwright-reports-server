import { env } from '../../config/env.js';
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

/** Caches the "model rejected images" verdict for the active provider+model. */
const MULTIMODAL_BLOCKLIST_TTL_MS = 60 * 60 * 1000;

export class LLMService {
  private static instance: LLMService;
  private provider: OpenAIProvider | AnthropicProvider | null = null;
  private config: LLMProviderConfig | null = null;
  /** Per-(provider+baseUrl+model) blocklist for multimodal image input. */
  private multimodalBlocklist = new Map<string, number>();

  private constructor() {
    const provider = env.LLM_PROVIDER ?? 'openai';

    this.config = {
      provider,
      baseUrl: env.LLM_BASE_URL ?? '',
      apiKey: env.LLM_API_KEY ?? '',
      model: env.LLM_MODEL ?? '',
      maxTokens: env.LLM_MAX_TOKENS,
      contextWindow: env.LLM_CONTEXT_WINDOW,
      multimodalMode: env.LLM_MULTIMODAL_MODE as MultimodalMode | undefined,
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
    return !!(this.config?.baseUrl && this.config?.apiKey);
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
      throw new Error('LLM service is not enabled. Set LLM_BASE_URL and LLM_API_KEY to enable');
    }

    if (!this.provider) {
      this.provider = this.createProvider();
      await this.provider.validateConfig();
    }
  }

  async getAvailableModels(): Promise<string[]> {
    if (!this.provider) {
      throw new Error('LLM provider not initialized');
    }

    return this.provider.getAvailableModels();
  }

  /** Resolve the effective image-attachment shape for a segmented call. */
  private resolveCallShape(prompt: SegmentedPrompt): {
    imagesMode: MultimodalMode;
    useImages: boolean;
  } {
    // runtime config higher priority than env
    const imagesMode = (this.config?.multimodalMode ??
      env.LLM_MULTIMODAL_MODE ??
      'auto') as MultimodalMode;
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

    // Determine whether images get attached before sending — the multimodal
    // blocklist auto-disables them after a prior unsupported-by-provider error.
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
            `[llm] multimodal unsupported by ${this.providerKey()} — retrying without images`
          );
          useImages = false;
          continue;
        }
        throw err;
      }
    }
    throw lastErr ?? new Error('sendSegmentedMessage exhausted retries');
  }

  private promptHasImages(prompt: SegmentedPrompt): boolean {
    return prompt.segments.some((s) => s.images && s.images.length > 0);
  }

  private providerKey(): string {
    return this.getProviderKey();
  }

  /** Public stable identifier for the active (provider+baseUrl+model) tuple.
   *  Used by route-level caches so they auto-invalidate when the config
   *  changes (which calls `restart()` and produces a
   *  different key). */
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

  /** Heuristic: model rejected images. Requires both a feature mention
   *  AND an explicit "not supported" / "does not support" signal — bare
   *  "image" or "vision" alone trips on size-limit / content-policy / field-
   *  malformed errors that have nothing to do with model capability. */
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

  /** Active model context window in tokens, or null if unknown. */
  async getContextWindow(): Promise<number | null> {
    if (!this.provider) {
      throw new Error('LLM provider not initialized');
    }
    return this.provider.getContextWindow();
  }

  /** Token count for a segmented prompt — exact for Anthropic, estimated otherwise. */
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

  /** Merge runtime overrides; drops undefined keys so partial payloads can't clobber
   *  env-supplied values. Resets the cached provider. */
  applyConfig(config?: Partial<LLMProviderConfig>): void {
    if (!config) return;
    const overrides = Object.fromEntries(
      Object.entries(config).filter(([, v]) => v !== undefined)
    ) as Partial<LLMProviderConfig>;
    this.config = {
      ...this.config,
      ...overrides,
    } as LLMProviderConfig;
    this.provider = null;
  }

  async restart(config?: Partial<LLMProviderConfig>): Promise<void> {
    this.applyConfig(config);
    await this.initialize();
  }

  /**
   * Test the connection without mutating the active provider. Builds a one-off
   * provider from the merged config (current + overrides), calls validateConfig
   * (hits the models endpoint), and returns a structured result. Used by the
   * Settings UI's "Test Connection" button.
   */
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

    if (!merged.baseUrl || !merged.apiKey) {
      return { success: false, error: 'Base URL and API key are required' };
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
      const ok = await provider.validateConfig();
      if (!ok) {
        return {
          success: false,
          error:
            'Provider rejected the request. Check the base URL and API key (the /models endpoint must be reachable).',
        };
      }
      const models = await provider.getAvailableModels();
      return { success: true, models };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Connection test failed',
      };
    }
  }
}

export const llmService = LLMService.getInstance();

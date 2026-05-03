import { env } from '../../config/env.js';
import { getCustomSystemPrompt, testFailedWithContext } from './prompts/index.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider } from './providers/openai.js';
import type { LLMProviderConfig, LLMStreamChunk } from './types/index.js';

export class LLMService {
  private static instance: LLMService;
  private provider: OpenAIProvider | AnthropicProvider | null = null;
  private config: LLMProviderConfig | null = null;

  private constructor() {
    const provider = env.LLM_PROVIDER ?? 'openai';

    this.config = {
      provider,
      baseUrl: env.LLM_BASE_URL ?? '',
      apiKey: env.LLM_API_KEY ?? '',
      model: env.LLM_MODEL ?? '',
      temperature: env.LLM_TEMPERATURE ?? 0.3,
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

  async sendMessage(
    prompt: string,
    systemPrompt?: string,
    context?: {
      totalRuns?: number;
      averageDuration?: number;
      isFlaky?: boolean;
      recentFailures?: number;
      additionalContext?: string;
    }
  ) {
    if (!this.provider) {
      throw new Error('LLM provider not initialized');
    }

    let enhancedPrompt = prompt;

    if (context) {
      enhancedPrompt = testFailedWithContext(prompt, context);
    }

    const finalSystemPrompt = getCustomSystemPrompt(systemPrompt);

    return this.provider.sendMessage(enhancedPrompt, finalSystemPrompt);
  }

  async sendMessageStream(
    prompt: string,
    onChunk: (chunk: LLMStreamChunk) => void,
    options?: {
      systemPrompt?: string;
      context?: {
        totalRuns?: number;
        averageDuration?: number;
        isFlaky?: boolean;
        recentFailures?: number;
        additionalContext?: string;
      };
    }
  ): Promise<void> {
    if (!this.provider) {
      throw new Error('LLM provider not initialized');
    }

    let enhancedPrompt = prompt;

    if (options?.context) {
      enhancedPrompt = testFailedWithContext(prompt, options.context);
    }

    const finalSystemPrompt = getCustomSystemPrompt(options?.systemPrompt);

    return this.provider.sendMessageStream(enhancedPrompt, onChunk, finalSystemPrompt);
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

    // biome-ignore lint/correctness/noUnusedVariables: apiKey is intentionally extracted to exclude from safe config
    const { apiKey, ...safeConfig } = this.config;
    return safeConfig;
  }

  async restart(config?: Partial<LLMProviderConfig>): Promise<void> {
    if (config) {
      this.config = {
        ...this.config,
        ...config,
      } as LLMProviderConfig;
    }

    this.provider = null;
    await this.initialize();
  }
}

export const llmService = LLMService.getInstance();

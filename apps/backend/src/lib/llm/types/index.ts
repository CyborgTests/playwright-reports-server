import type { LLMMultimodalMode, LLMProviderType } from '@playwright-reports/shared';

export type { LLMProviderType };

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PromptImage {
  // base64, no "data:" prefix
  data: string;
  // mime type
  mediaType: string;
  source?: string;
}

export interface PromptSegment {
  id: string;
  role: 'system' | 'user';
  stable: boolean;
  /** Final rendered content sent to the provider. */
  content: string;
  images?: PromptImage[];
}

export type MultimodalMode = LLMMultimodalMode;

export interface SegmentedPrompt {
  segments: PromptSegment[];
}

export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  system?: string;
  /** Provider-friendly segmented form. When present, providers prefer this over
   *  `messages` + `system` and apply cache_control / message ordering. */
  segments?: PromptSegment[];
  maxTokens?: number;
}

export interface LLMResponse {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens?: number;
  };
  model: string;
  finishReason?: string;
}

export interface LLMModelError {
  code: string;
  message: string;
  type:
    | 'authentication'
    | 'rate_limit'
    | 'invalid_request'
    | 'server_error'
    | 'timeout'
    | 'network';
  statusCode?: number;
}

export interface LLMProviderConfig {
  provider: LLMProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Temperature is optional. When undefined, providers omit the field
   *  from the request body and the model uses its own default (typically
   *  ~1.0). Per-call overrides via SendOptions still take precedence. */
  temperature?: number;
  /** Default max output tokens. OpenAI/local omit when undefined; Anthropic
   *  falls back to its hardcoded safe default (8000) when undefined. */
  maxTokens?: number;
  /** Manual override for context window. Useful for local models whose
   *  /models response does not advertise it. */
  contextWindow?: number;
  /** Override for the global multimodal mode. Same precedence rules as the env var. */
  multimodalMode?: MultimodalMode;
  requestTimeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

export abstract class BaseLLMProvider {
  protected readonly config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
  }

  abstract sendMessage(prompt: string, systemPrompt?: string): Promise<LLMResponse>;
  abstract validateConfig(): Promise<boolean>;
  abstract getAvailableModels(): Promise<string[]>;

  protected abstract createRequest(prompt: string, systemPrompt?: string): LLMRequest;
  protected abstract sendRequest(request: LLMRequest): Promise<Response>;
  protected abstract parseResponse(response: Response, request?: LLMRequest): Promise<LLMResponse>;
  protected abstract handleError(error: unknown): LLMProviderError;

  protected async retryRequest<T>(
    operation: () => Promise<T>,
    maxRetries: number = this.config.maxRetries,
    delayMs: number = this.config.retryDelayMs
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxRetries) {
          break;
        }

        if (error instanceof LLMProviderError) {
          break;
        }

        // exponential backoff
        const backoffDelay = delayMs * 2 ** attempt + Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      }
    }

    throw lastError || new Error('Operation failed after retries');
  }

  protected async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number = this.config.requestTimeoutMs
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new LLMProviderError('Request timeout', 'timeout', 408));
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }
}

export class LLMProviderError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;

  constructor(message: string, code: string = 'unknown', statusCode?: number) {
    super(message);
    this.name = 'LLMProviderError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type LLMProviderType = 'openai' | 'anthropic';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PromptImage {
  /** Base64-encoded image data (no `data:` URI prefix). */
  data: string;
  /** MIME type, e.g. 'image/png' or 'image/jpeg'. */
  mediaType: string;
  /** Origin path or filename — kept for debug, not sent to the provider. */
  source?: string;
}

/**
 * A discrete chunk of prompt content. Builders emit segments in stability order
 * (most-stable first) so providers can place cache_control hints (Anthropic) and
 * the token prefix matches across calls (OpenAI / LM Studio KV cache).
 *
 * - `stable` — content that doesn't change across calls within the cache TTL
 *   (system prompt, schema, per-test history). Used for cache_control placement.
 * - `images` — multimodal attachments. Providers emit image content blocks
 *   before text in the same role's message.
 */
export interface PromptSegment {
  id: string;
  role: 'system' | 'user';
  stable: boolean;
  /** Final rendered content sent to the provider. */
  content: string;
  images?: PromptImage[];
}

export type MultimodalMode = 'auto' | 'force' | 'disabled';

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
  /** When set, the provider must request structured output matching this
   *  schema. On unsupported-by-provider errors, the caller decides whether to
   *  retry without schema (mode=auto) or fail (mode=force). */
  responseSchema?: LLMResponseSchema;
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
  /** Parsed JSON object when the request used a response schema (Anthropic
   *  tool_use input or OpenAI response_format json_schema). Undefined when
   *  the request was unstructured or the provider rejected the schema. */
  structuredOutput?: unknown;
}

/**
 * Describes the structured-output shape requested for a call. The provider
 * translates this to the right wire format: Anthropic tool use with the
 * `submit_<name>` tool forced via tool_choice, OpenAI response_format with
 * type 'json_schema' in strict mode.
 */
export interface LLMResponseSchema {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

export type StructuredOutputMode = 'auto' | 'force' | 'disabled';

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
  /** Override for the global structured-output mode. When set on the runtime
   *  config it wins over `LLM_STRUCTURED_OUTPUT_MODE`; falls back to env then
   *  to 'auto'. */
  structuredOutputMode?: StructuredOutputMode;
  /** Override for the global multimodal mode. Same precedence rules as above. */
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

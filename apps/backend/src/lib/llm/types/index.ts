export type LLMProviderType = 'openai' | 'anthropic';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  system?: string;
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

export interface LLMStreamChunk {
  type: 'token' | 'thinking' | 'done' | 'error';
  content?: string;
  model?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens?: number;
  };
  finishReason?: string;
  error?: string;
}

export interface StreamAccumulator {
  buffer: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens?: number;
  };
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
  temperature: number;
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
  abstract sendMessageStream(
    prompt: string,
    onChunk: (chunk: LLMStreamChunk) => void,
    systemPrompt?: string
  ): Promise<void>;
  abstract validateConfig(): Promise<boolean>;
  abstract getAvailableModels(): Promise<string[]>;

  protected abstract createRequest(prompt: string, systemPrompt?: string): LLMRequest;
  protected abstract sendRequest(request: LLMRequest): Promise<Response>;
  protected abstract sendStreamRequest(request: LLMRequest): Promise<Response>;
  protected abstract parseResponse(response: Response): Promise<LLMResponse>;
  protected abstract parseStreamLine(
    line: string,
    accumulator: StreamAccumulator
  ): LLMStreamChunk | null;
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

  protected async processStream(
    response: Response,
    onChunk: (chunk: LLMStreamChunk) => void
  ): Promise<void> {
    if (!response.ok) {
      throw this.handleError({
        status: response.status,
        statusText: response.statusText,
      });
    }

    if (!response.body) {
      throw new LLMProviderError('No response body', 'network');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const accumulator: StreamAccumulator = {
      buffer: '',
    };

    try {
      let totalLines = 0;
      let parsedChunks = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || trimmedLine.startsWith(':')) {
            continue;
          }

          totalLines++;
          const chunk = this.parseStreamLine(trimmedLine, accumulator);
          if (chunk) {
            parsedChunks++;
            onChunk(chunk);
          }
        }
      }

      // Process any remaining data in the buffer
      if (buffer.trim()) {
        totalLines++;
        const chunk = this.parseStreamLine(buffer.trim(), accumulator);
        if (chunk) {
          parsedChunks++;
          onChunk(chunk);
        }
      }

      console.log(`[llm] processStream: ${totalLines} SSE line(s), ${parsedChunks} token chunk(s)`);

      // If no tokens were parsed, check if the response was a JSON error
      if (parsedChunks === 0 && buffer.trim()) {
        try {
          const errorJson = JSON.parse(buffer.trim());
          if (errorJson.error) {
            onChunk({
              type: 'error',
              error: typeof errorJson.error === 'string' ? errorJson.error : JSON.stringify(errorJson.error),
            });
            return;
          }
        } catch {
          // not JSON, ignore
        }
      }

      onChunk({
        type: 'done',
        model: this.config.model,
        usage: accumulator.usage,
        finishReason: accumulator.finishReason,
      });
    } finally {
      reader.releaseLock();
    }
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

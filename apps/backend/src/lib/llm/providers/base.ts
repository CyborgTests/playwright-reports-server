import { withError } from '../../withError.js';
import type { LLMRequest, LLMResponse, LLMStreamChunk } from '../types/index.js';
import { BaseLLMProvider as BaseProvider, LLMProviderError } from '../types/index.js';

export abstract class LLMProvider extends BaseProvider {
  protected abstract getApiEndpoint(): string;
  protected abstract getStreamApiEndpoint(): string;
  protected abstract getModelsEndpoint(): string;
  protected abstract getDefaultHeaders(): Record<string, string>;

  async sendMessageStream(
    prompt: string,
    onChunk: (chunk: LLMStreamChunk) => void,
    systemPrompt?: string
  ): Promise<void> {
    let modelToUse = this.config.model;

    if (!modelToUse) {
      const bestModel = await this.getBestAvailableModel();
      if (!bestModel) {
        onChunk({
          type: 'error',
          error: 'No model configured and no suitable models found',
        });
        return;
      }
      modelToUse = bestModel;
    }

    const request = this.createRequest(prompt, systemPrompt, modelToUse);

    return this.retryRequest(async () => {
      const response = await this.withTimeout(this.sendStreamRequest(request));
      return this.processStream(response, onChunk);
    });
  }

  async sendMessage(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    let modelToUse = this.config.model;

    if (!modelToUse) {
      const bestModel = await this.getBestAvailableModel();
      if (!bestModel) {
        throw new Error('No model configured and no suitable models found');
      }
      modelToUse = bestModel;
    }

    const request = this.createRequest(prompt, systemPrompt, modelToUse);

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

      return this.parseResponse(response);
    });
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
      console.log(
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

    // Common error patterns
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

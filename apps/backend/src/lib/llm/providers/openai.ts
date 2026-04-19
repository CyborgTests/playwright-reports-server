import type { LLMRequest, LLMResponse, LLMStreamChunk, StreamAccumulator } from '../types/index.js';
import { LLMProvider } from './base.js';
import type { OpenAIModelList, OpenAIRequest, OpenAIResponse, OpenAIStreamChunk } from './types.js';

export class OpenAIProvider extends LLMProvider {
  protected getApiEndpoint(): string {
    return `${this.config.baseUrl}/chat/completions`;
  }

  protected getStreamApiEndpoint(): string {
    return `${this.config.baseUrl}/chat/completions`;
  }

  protected getModelsEndpoint(): string {
    return `${this.config.baseUrl}/models`;
  }

  protected getDefaultHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
    };
  }

  protected formatRequestBody(request: LLMRequest): OpenAIRequest {
    return {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: 8000,
    } as OpenAIRequest;
  }

  protected formatStreamRequestBody(request: LLMRequest): OpenAIRequest {
    return {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: 8000,
      stream: true,
    } as OpenAIRequest;
  }

  protected async parseResponse(response: Response): Promise<LLMResponse> {
    const data = (await response.json()) as OpenAIResponse;

    return {
      content: data.choices?.[0]?.message?.content || '',
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
      model: data.model || this.config.model,
      finishReason: data.choices?.[0]?.finish_reason,
    };
  }

  protected parseStreamLine(line: string, accumulator: StreamAccumulator): LLMStreamChunk | null {
    if (!line.startsWith('data: ')) {
      return null;
    }

    const data = line.slice(6); // Remove 'data: ' prefix

    if (data.trim() === '[DONE]') {
      return null;
    }

    try {
      const chunk = JSON.parse(data) as OpenAIStreamChunk;
      const choice = chunk.choices?.[0];

      if (!choice) {
        return null;
      }

      if (choice.delta?.reasoning_content) {
        return {
          type: 'thinking',
          content: choice.delta.reasoning_content,
        };
      }

      if (choice.delta?.content) {
        return {
          type: 'token',
          content: choice.delta.content,
        };
      }

      if (choice.finish_reason) {
        accumulator.finishReason = choice.finish_reason;
      }

      if (chunk.usage) {
        accumulator.usage = {
          inputTokens: chunk.usage.prompt_tokens || 0,
          outputTokens: chunk.usage.completion_tokens || 0,
          totalTokens: chunk.usage.total_tokens || 0,
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  protected extractModelIds(data: OpenAIModelList): string[] {
    return data.data?.map((model) => model.id) || [];
  }
}

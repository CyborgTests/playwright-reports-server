import type {
  LLMRequest,
  LLMResponse,
  LLMStreamChunk,
  PromptSegment,
  StreamAccumulator,
} from '../types/index.js';
import { LLMProvider } from './base.js';
import type {
  OpenAIImagePart,
  OpenAIMessageContent,
  OpenAIModelList,
  OpenAIRequest,
  OpenAIResponse,
  OpenAIStreamChunk,
  OpenAITextPart,
} from './types.js';

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

  /**
   * Build OpenAI/LM Studio messages from segments. Same-role consecutive
   * segments are joined with double-newlines into a single message — keeps
   * the request shape simple and ensures byte-stable token prefixes for
   * llama.cpp / vLLM KV cache reuse, since stable segments are emitted before
   * varying ones by the prompt builders.
   *
   * When any user-role segment has images, the user message content becomes
   * an array of content parts (image_url first, then text). Text-only stays
   * a plain string for maximum compatibility with older OpenAI-compatible
   * servers that don't accept content arrays.
   */
  private buildMessagesFromSegments(
    segments: PromptSegment[]
  ): Array<{ role: 'system' | 'user'; content: OpenAIMessageContent }> {
    const systemParts: string[] = [];
    const userTextParts: string[] = [];
    const userImages: OpenAIImagePart[] = [];

    for (const seg of segments) {
      if (seg.role === 'system') {
        systemParts.push(seg.content);
      } else {
        if (seg.images && seg.images.length > 0) {
          for (const img of seg.images) {
            userImages.push({
              type: 'image_url',
              image_url: { url: `data:${img.mediaType};base64,${img.data}` },
            });
          }
        }
        userTextParts.push(seg.content);
      }
    }

    const messages: Array<{ role: 'system' | 'user'; content: OpenAIMessageContent }> = [];
    if (systemParts.length > 0) {
      messages.push({ role: 'system', content: systemParts.join('\n\n') });
    }
    if (userTextParts.length > 0 || userImages.length > 0) {
      const userText = userTextParts.join('\n\n');
      if (userImages.length === 0) {
        messages.push({ role: 'user', content: userText });
      } else {
        const parts: Array<OpenAITextPart | OpenAIImagePart> = [
          ...userImages,
          { type: 'text', text: userText },
        ];
        messages.push({ role: 'user', content: parts });
      }
    }
    return messages;
  }

  protected formatRequestBody(request: LLMRequest): OpenAIRequest {
    const messages =
      request.segments && request.segments.length > 0
        ? this.buildMessagesFromSegments(request.segments)
        : request.messages;

    const body: OpenAIRequest = {
      model: request.model,
      messages,
      temperature: request.temperature,
    };
    if (typeof request.maxTokens === 'number') {
      body.max_tokens = request.maxTokens;
    }
    if (request.responseSchema) {
      // OpenAI / LM Studio / vLLM strict json_schema. The model is constrained
      // to emit JSON matching the schema; any other text causes an error.
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: request.responseSchema.name,
          description: request.responseSchema.description,
          schema: request.responseSchema.schema,
          strict: true,
        },
      };
    }
    return body;
  }

  protected formatStreamRequestBody(request: LLMRequest): OpenAIRequest {
    return {
      ...this.formatRequestBody(request),
      stream: true,
    };
  }

  protected async parseResponse(response: Response, request?: LLMRequest): Promise<LLMResponse> {
    const data = (await response.json()) as OpenAIResponse;
    const content = data.choices?.[0]?.message?.content || '';

    // Only attempt structured-output extraction when the request actually
    // asked for it. Otherwise free-form analyses that happen to start with
    // `{` or `[` (markdown snippets, stack-trace JSON fragments) get
    // mis-classified as structured output and confuse downstream callers
    // that prefer `structuredOutput` over `content`.
    let structuredOutput: unknown;
    if (request?.responseSchema) {
      try {
        structuredOutput = JSON.parse(content);
      } catch {
        // strict json_schema should not produce non-JSON, but tolerate it
        // and let the text path handle the response.
      }
    }

    return {
      content,
      structuredOutput,
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

  /**
   * Probe the /models endpoint for a context-window field. Different
   * OpenAI-compatible servers expose this under different names — we accept
   * the common ones. LM Studio reports `loaded_context_length`; vLLM reports
   * `max_model_len`; some servers report `context_length` or `n_ctx`. Returns
   * null if the model is not found or no field is present.
   */
  protected async detectContextWindow(): Promise<number | null> {
    if (!this.config.model) return null;
    try {
      const response = await this.withTimeout(
        fetch(this.getModelsEndpoint(), {
          method: 'GET',
          headers: this.getHeaders(),
        }),
        5_000
      );
      if (!response.ok) return null;
      const data = (await response.json()) as { data?: Array<Record<string, unknown>> };
      const entry = data.data?.find((m) => m.id === this.config.model);
      if (!entry) return null;
      const candidates = [
        'loaded_context_length',
        'context_length',
        'max_model_len',
        'max_context_length',
        'n_ctx',
      ];
      for (const key of candidates) {
        const v = entry[key];
        if (typeof v === 'number' && v > 0) return v;
      }
      return null;
    } catch {
      return null;
    }
  }
}

import type { LLMRequest, LLMResponse, PromptSegment } from '../types/index.js';
import { LLMProvider } from './base.js';
import type {
  OpenAIImagePart,
  OpenAIMessageContent,
  OpenAIModelList,
  OpenAIRequest,
  OpenAIResponse,
  OpenAITextPart,
} from './types.js';

export class OpenAIProvider extends LLMProvider {
  protected getApiEndpoint(): string {
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
    return body;
  }

  protected async parseResponse(response: Response): Promise<LLMResponse> {
    const data = (await response.json()) as OpenAIResponse;
    const message = data.choices?.[0]?.message;
    const rawContent = message?.content || '';
    const rawReasoning = message?.reasoning_content || '';

    return {
      content,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
      model: data.model || this.config.model,
      finishReason: data.choices?.[0]?.finish_reason,
    };
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

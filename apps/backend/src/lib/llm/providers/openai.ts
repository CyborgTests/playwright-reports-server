import type { DiscoveredModel } from '@playwright-reports/shared';
import { parseOpenAiCompatibleModels } from '../discovery.js';
import type { LLMProviderConfig, LLMRequest, LLMResponse, PromptSegment } from '../types/index.js';
import { LLMProvider, type ProbeResult } from './base.js';
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
    return this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {};
  }

  /**
   * Build OpenAI/LM Studio messages from segments. Same-role consecutive
   * segments are joined with double-newlines into a single message - keeps
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
    const content = rawContent || rawReasoning;

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

  /**
   * POST a 1-token ping to /chat/completions. An OpenAI-shaped error body (other
   * than 401/403) still counts as reachable, e.g. a model that rejects max_tokens.
   */
  async probe(model: string | undefined): Promise<ProbeResult> {
    if (!model) {
      return {
        ok: false,
        error: 'No model available to verify the chat completions endpoint.',
      };
    }

    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
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

    // Bedrock may 404 /models before checking auth, so reject auth errors here too.
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        error: `Authentication failed (${response.status}) at /chat/completions.`,
      };
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

  protected extractModelIds(data: OpenAIModelList): string[] {
    return data.data?.map((model) => model.id) || [];
  }

  protected parseDiscoveredModels(data: unknown): DiscoveredModel[] {
    return parseOpenAiCompatibleModels(data);
  }

  /**
   * Probe the /models endpoint for a context-window field. Different
   * OpenAI-compatible servers expose this under different names - we accept
   * the common ones. LM Studio reports `loaded_context_length`; vLLM reports
   * `max_model_len`; some servers report `context_length` or `n_ctx`. Returns
   * null if the model is not found or no field is present.
   */
  protected async detectContextWindow(): Promise<number | null> {
    if (!this.config.model) return null;
    try {
      const response = await this.withTimeout(
        (signal) =>
          fetch(this.getModelsEndpoint(), {
            method: 'GET',
            headers: this.getHeaders(),
            signal,
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

/** Foundry's v1 API lives under `/openai/v1`; accept a pasted resource root too. */
export function normalizeFoundryBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/openai/v1')) return trimmed;
  if (trimmed.endsWith('/openai')) return `${trimmed}/v1`;
  return `${trimmed}/openai/v1`;
}

/** Azure AI Foundry / Azure OpenAI v1: OpenAI wire format, `model` = deployment name. */
export class AzureFoundryProvider extends OpenAIProvider {
  constructor(config: LLMProviderConfig) {
    super({ ...config, baseUrl: normalizeFoundryBaseUrl(config.baseUrl) });
  }

  protected getDefaultHeaders(): Record<string, string> {
    // Foundry accepts either header; sending both covers keys and proxies that only honor one.
    return this.config.apiKey
      ? { Authorization: `Bearer ${this.config.apiKey}`, 'api-key': this.config.apiKey }
      : {};
  }
}

/**
 * AWS Bedrock OpenAI-compatible endpoint
 * (`https://bedrock-runtime.<region>.amazonaws.com/openai/v1`) with a Bedrock API key as Bearer.
 */
export class BedrockProvider extends OpenAIProvider {
  /** Bedrock may not serve /models; only an auth failure there fails the check. */
  async validateConfig(): Promise<boolean> {
    try {
      const response = await this.withTimeout(
        (signal) =>
          fetch(this.getModelsEndpoint(), { method: 'GET', headers: this.getHeaders(), signal }),
        5000
      );
      return response.ok || response.status === 404;
    } catch {
      return false;
    }
  }
}

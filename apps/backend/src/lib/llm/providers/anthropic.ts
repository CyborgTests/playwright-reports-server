import type { LLMRequest, LLMResponse, PromptSegment, SegmentedPrompt } from '../types/index.js';
import { LLMProvider } from './base.js';
import type {
  AnthropicContentBlock,
  AnthropicImageBlock,
  AnthropicModelList,
  AnthropicRequest,
  AnthropicResponse,
  AnthropicTextBlock,
} from './types.js';

const DEFAULT_ANTHROPIC_MAX_TOKENS = 8000;

/**
 * Anthropic does not expose context windows via /v1/models, so we look them up
 * by model-family prefix. Returns null for unknown models (caller falls back
 * to a safe default or to manual config override).
 *
 * Source: https://docs.anthropic.com/en/docs/about-claude/models — keep this
 * roughly in sync. All Claude 3.x and 4.x models documented at writing
 * support 200k context.
 */
function lookupAnthropicContextWindow(model: string): number | null {
  if (!model) return null;
  const m = model.toLowerCase();
  // Claude 4.x and 3.x families all advertise 200k context.
  if (m.includes('claude-opus') || m.includes('claude-sonnet') || m.includes('claude-haiku')) {
    return 200_000;
  }
  if (m.startsWith('claude-3') || m.startsWith('claude-4')) {
    return 200_000;
  }
  return null;
}

export class AnthropicProvider extends LLMProvider {
  protected getApiEndpoint(): string {
    return `${this.config.baseUrl}/messages`;
  }

  protected getModelsEndpoint(): string {
    return `${this.config.baseUrl}/models`;
  }

  protected getDefaultHeaders(): Record<string, string> {
    return {
      'x-api-key': this.config.apiKey,
    };
  }

  protected createRequest(prompt: string, systemPrompt?: string, _model?: string): LLMRequest {
    const messages = [{ role: 'user' as const, content: prompt }];

    return {
      model: this.config.model,
      messages,
      system: systemPrompt,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    };
  }

  /**
   * Build the Anthropic body from a segmented prompt: joins same-role segments,
   * then sets cache_control:ephemeral on the last stable system block and the
   * first + last stable user blocks. The user breakpoints nest — the first (task
   * contract, identical per task type) caches across the queue batch; the last
   * (per-test context) caches across regenerates. ≤3 breakpoints (Anthropic's
   * limit is 4), caching the stable prefix and leaving the varying tail uncached.
   */
  private buildBodyFromSegments(segments: PromptSegment[], request: LLMRequest): AnthropicRequest {
    const systemBlocks: AnthropicTextBlock[] = [];
    const userBlocks: AnthropicContentBlock[] = [];
    // Track the index of each segment's first text block so we can place
    // cache_control on the right one (Anthropic caches the prefix up to and
    // including the marked block — must be a stable segment's text block).
    let lastStableSystemTextIdx = -1;
    let firstStableUserTextIdx = -1;
    let lastStableUserTextIdx = -1;

    for (const seg of segments) {
      // Image blocks come BEFORE the segment's text, in line with Anthropic's
      // recommendation that visual context precede the textual instruction
      // referring to it.
      if (seg.role === 'user' && seg.images && seg.images.length > 0) {
        for (const img of seg.images) {
          const imgBlock: AnthropicImageBlock = {
            type: 'image',
            source: { type: 'base64', media_type: img.mediaType, data: img.data },
          };
          userBlocks.push(imgBlock);
        }
      }

      const textBlock: AnthropicTextBlock = { type: 'text', text: seg.content };
      if (seg.role === 'system') {
        if (seg.stable) lastStableSystemTextIdx = systemBlocks.length;
        systemBlocks.push(textBlock);
      } else {
        if (seg.stable) {
          if (firstStableUserTextIdx === -1) firstStableUserTextIdx = userBlocks.length;
          lastStableUserTextIdx = userBlocks.length;
        }
        userBlocks.push(textBlock);
      }
    }

    if (lastStableSystemTextIdx >= 0) {
      systemBlocks[lastStableSystemTextIdx].cache_control = { type: 'ephemeral' };
    }
    // dedupe: when only one stable user block exists, first === last.
    for (const idx of new Set([firstStableUserTextIdx, lastStableUserTextIdx])) {
      if (idx < 0) continue;
      const target = userBlocks[idx];
      if (target.type === 'text') {
        target.cache_control = { type: 'ephemeral' };
      }
    }

    const body: AnthropicRequest = {
      model: request.model,
      max_tokens: request.maxTokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS,
      messages: [{ role: 'user', content: userBlocks }],
      system: systemBlocks,
      temperature: request.temperature,
    };

    return body;
  }

  protected formatRequestBody(request: LLMRequest): AnthropicRequest {
    if (request.segments && request.segments.length > 0) {
      return this.buildBodyFromSegments(request.segments, request);
    }

    // Legacy path: messages + system as plain strings.
    return {
      model: request.model,
      max_tokens: request.maxTokens ?? DEFAULT_ANTHROPIC_MAX_TOKENS,
      messages: request.messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      system: request.system,
      temperature: request.temperature,
    };
  }

  protected async parseResponse(response: Response): Promise<LLMResponse> {
    const data = (await response.json()) as AnthropicResponse;

    const textBlock = data.content?.find((b) => b.type === 'text');
    const content = textBlock?.text ?? '';

    return {
      content,
      usage: {
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
      model: data.model || this.config.model,
      finishReason: data.stop_reason || undefined,
    };
  }

  protected extractModelIds(data: AnthropicModelList): string[] {
    return data.data?.map((model) => model.id) || [];
  }

  protected async detectContextWindow(): Promise<number | null> {
    return lookupAnthropicContextWindow(this.config.model);
  }

  /**
   * Exact token count via Anthropic's /v1/messages/count_tokens. Free, no
   * billing impact, and uses the same tokenization the model itself uses.
   * Falls back to the base 4-chars-per-token estimator on failure.
   */
  override async countTokens(prompt: SegmentedPrompt): Promise<number> {
    if (!prompt.segments.length) return 0;

    const body = this.buildBodyFromSegments(prompt.segments, {
      model: this.config.model,
      messages: [],
      segments: prompt.segments,
      maxTokens: 1,
    });

    try {
      const response = await this.withTimeout(
        fetch(`${this.config.baseUrl}/messages/count_tokens`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({
            model: body.model,
            messages: body.messages,
            system: body.system,
          }),
        }),
        10_000
      );
      if (!response.ok) {
        return this.estimateTokensFromText(this.serializeSegmentsForCounting(prompt));
      }
      const data = (await response.json()) as { input_tokens?: number };
      if (typeof data.input_tokens === 'number') {
        return data.input_tokens;
      }
    } catch (err) {
      console.warn(
        `[llm] count_tokens failed, falling back to estimator: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return this.estimateTokensFromText(this.serializeSegmentsForCounting(prompt));
  }
}

import { llmService } from '../../index.js';
import type { FailureDetailsForPrompt } from '../../prompts/index.js';
import { fitPromptToBudget } from '../../prompts/index.js';
import type { SegmentedPrompt } from '../../types/index.js';
import { readImageAttachment } from './reportEnrichment.js';

export const OUTPUT_RESERVE_TOKENS_BY_TASK = {
  testAnalysis: 4000,
  reportSummary: 6000,
  projectSummary: 8000,
} as const;

const DEFAULT_OUTPUT_RESERVE_TOKENS = OUTPUT_RESERVE_TOKENS_BY_TASK.projectSummary;
const SAFETY_MARGIN_TOKENS = 1000;

export const TASK_TEMPERATURE_DEFAULTS = {
  testAnalysis: 0.2,
  reportSummary: 0.3,
  projectSummary: 0.3,
} as const;

const NO_CONTEXT_CHAR_FALLBACK = 30_000;

export async function attachScreenshotIfAny(
  builtPrompt: SegmentedPrompt,
  details: FailureDetailsForPrompt,
  reportId: string,
  logPrefix?: string
): Promise<void> {
  const imageAtt = details.attachments?.find((a) => a.contentType?.startsWith('image/'));
  if (!imageAtt) return;
  const img = await readImageAttachment(reportId, imageAtt);
  if (!img) return;
  const failureIdx = builtPrompt.segments.findIndex((s) => s.id === 'current_failure');
  if (failureIdx < 0) return;
  builtPrompt.segments[failureIdx] = {
    ...builtPrompt.segments[failureIdx],
    images: [img],
  };
  if (logPrefix) {
    console.log(`${logPrefix}: attached screenshot ${imageAtt.path} (${img.mediaType})`);
  }
}

export async function fitToContextWindow(
  prompt: SegmentedPrompt,
  outputReserveTokens: number = DEFAULT_OUTPUT_RESERVE_TOKENS
): Promise<{ prompt: SegmentedPrompt; log: string | null }> {
  const window = await llmService.getContextWindow().catch(() => null);
  const tokens = await llmService.countTokens(prompt).catch(() => null);
  const totalChars = prompt.segments.reduce((sum, s) => sum + s.content.length, 0);

  if (!window) {
    const fit = fitPromptToBudget(prompt, NO_CONTEXT_CHAR_FALLBACK);
    if (fit.changes.length === 0) return { prompt: fit.prompt, log: null };
    return {
      prompt: fit.prompt,
      log: `[no context window detected; cap=${NO_CONTEXT_CHAR_FALLBACK} chars] ${fit.changes.join(', ')}`,
    };
  }

  const inputBudgetTokens = window - outputReserveTokens - SAFETY_MARGIN_TOKENS;
  if (inputBudgetTokens <= 0 || tokens === null || tokens <= inputBudgetTokens) {
    return { prompt, log: null };
  }

  const charsPerToken = totalChars / tokens;
  const charsBudget = Math.floor(inputBudgetTokens * charsPerToken);
  const fit = fitPromptToBudget(prompt, charsBudget);

  if (fit.changes.length === 0) return { prompt: fit.prompt, log: null };
  return {
    prompt: fit.prompt,
    log: `[over budget: ${tokens}>${inputBudgetTokens} tokens] ${fit.changes.join(', ')}`,
  };
}

import { llmService } from '../../index.js';
import type { FailureDetailsForPrompt } from '../../prompts/index.js';
import { fitPromptToBudget } from '../../prompts/index.js';
import type { PromptImage, PromptSegment, SegmentedPrompt } from '../../types/index.js';
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

export async function collectScreenshotImages(
  details: FailureDetailsForPrompt,
  reportId: string
): Promise<PromptImage[]> {
  const imageAtt = details.attachments?.find((a) => a.contentType?.startsWith('image/'));
  if (!imageAtt) return [];
  const img = await readImageAttachment(reportId, imageAtt);
  return img ? [img] : [];
}

function numberedList(items: string[]): string {
  return items.map((item, i) => `${i + 1}. ${item}`).join('\n');
}

export function attachScreenshotImages(
  builtPrompt: SegmentedPrompt,
  images: PromptImage[],
  logPrefix?: string
): void {
  if (images.length === 0) return;
  const failureIdx = builtPrompt.segments.findIndex((s) => s.id === 'current_failure');
  if (failureIdx < 0) return;
  const seg = builtPrompt.segments[failureIdx];
  const caption =
    images.length > 1
      ? `## Screenshots\nAttached image(s), in order:\n${numberedList(images.map((im) => im.source ?? 'screenshot'))}\n\n`
      : '';
  builtPrompt.segments[failureIdx] = {
    ...seg,
    content: `${caption}${seg.content}`,
    images,
  };
  if (logPrefix) {
    console.log(`${logPrefix}: attached ${images.length} screenshot(s) inline`);
  }
}

export function injectScreenshotDescription(
  builtPrompt: SegmentedPrompt,
  text: string,
  labels: string[] = []
): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const manifest =
    labels.length > 1 ? `Frames described below, in order:\n${numberedList(labels)}\n\n` : '';
  const segment: PromptSegment = {
    id: 'screenshot_description',
    role: 'user',
    stable: false,
    content: `## Screenshot Description\nText transcription of the failure screenshot(s) by a vision model (no raw image is included).\n\n${manifest}${trimmed}`,
  };
  const afterFailure = builtPrompt.segments.findIndex((s) => s.id === 'current_failure');
  if (afterFailure >= 0) {
    builtPrompt.segments.splice(afterFailure + 1, 0, segment);
    return;
  }
  const afterSnapshot = builtPrompt.segments.findIndex((s) => s.id === 'page_snapshot');
  if (afterSnapshot >= 0) builtPrompt.segments.splice(afterSnapshot + 1, 0, segment);
  else builtPrompt.segments.push(segment);
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

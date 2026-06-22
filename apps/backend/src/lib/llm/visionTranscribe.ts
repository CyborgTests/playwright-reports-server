import { configCache } from '../service/cache/config.js';
import { type LlmModelRow, llmModelsDb, llmTasksDb } from '../service/db/index.js';
import { llmService } from './index.js';
import { modelRowToProviderConfig, runOnModel } from './registry.js';
import type { PromptImage, SegmentedPrompt } from './types/index.js';

const SCREENSHOT_PARSE_TEMPERATURE = 0.1;

export const DEFAULT_SCREENSHOT_PARSE_PROMPT = `You convert screenshots from a failed Playwright test into a literal text description for another model that cannot see images.

Describe only what is visible:
- The overall screen/page and its apparent state.
- Any visible error messages, stack traces, toasts, dialogs, or banners - quote their text exactly.
- UI elements relevant to a failure (buttons, inputs, modals, loading/empty states).
- Anything that looks broken, missing, misrendered, or unexpected.

Rules:
- Be factual and literal. Transcribe visible text verbatim where it matters.
- Do NOT diagnose the root cause, speculate about code, or suggest fixes - another model does that.
- When multiple screenshots are provided, head each one's description with the exact label given for it (the labels encode timing/role, e.g. "### before failed action" or "### frame (t+1200ms)") and describe them in that order.
- Keep it concise; skip decorative styling.`;

export interface ScreenshotTranscription {
  text: string;
  model: string;
}

export function resolveScreenshotModel(): LlmModelRow | null {
  const modelId = configCache.config?.llm?.screenshotModel?.modelId;
  if (!modelId) return null;
  return llmModelsDb.list().find((m) => m.id === modelId && m.enabled === 1) ?? null;
}

export async function transcribeScreenshots(
  images: PromptImage[],
  parentTaskId: string,
  logPrefix?: string
): Promise<ScreenshotTranscription | null> {
  if (images.length === 0) return null;
  const row = resolveScreenshotModel();
  if (!row) return null;

  const instructions =
    configCache.config?.llm?.customScreenshotParsePrompt?.trim() || DEFAULT_SCREENSHOT_PARSE_PROMPT;
  const prompt: SegmentedPrompt = {
    segments: [
      { id: 'screenshot_parse_system', role: 'system', stable: true, content: instructions },
      {
        id: 'screenshot_parse_images',
        role: 'user',
        stable: false,
        content:
          images.length > 1
            ? `Transcribe these ${images.length} screenshots in order:\n${images
                .map((im, i) => `${i + 1}. ${im.source ?? 'screenshot'}`)
                .join('\n')}`
            : `Transcribe this screenshot${images[0]?.source ? ` (${images[0].source})` : ''}.`,
        images,
      },
    ],
  };

  const childId = llmTasksDb.startRoleExecution({
    parentTaskId,
    type: 'test_analysis',
    role: 'screenshot_parser',
    model: row.model,
    baseUrl: row.baseUrl,
  });
  try {
    const resp = await runOnModel(
      row,
      () =>
        llmService.sendViaModel(
          { ...modelRowToProviderConfig(row), multimodalMode: 'force' },
          prompt,
          {
            temperature: SCREENSHOT_PARSE_TEMPERATURE,
          }
        ),
      () => llmTasksDb.markRoleProcessing(childId)
    );
    if (row.lastError) llmModelsDb.setLastError(row.id, null);
    const text = resp.content.trim();
    llmTasksDb.finishRoleExecution(childId, {
      status: 'completed',
      model: resp.model,
      baseUrl: row.baseUrl,
      usage: resp.usage,
      result: text,
      category: `${images.length} screenshot${images.length === 1 ? '' : 's'}`,
    });
    if (logPrefix) {
      console.log(`${logPrefix}: transcribed ${images.length} screenshot(s) via ${row.label}`);
    }
    return text ? { text, model: resp.model } : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    llmModelsDb.setLastError(row.id, msg);
    llmTasksDb.finishRoleExecution(childId, {
      status: 'failed',
      model: row.model,
      baseUrl: row.baseUrl,
      error: msg,
    });
    console.warn(
      `${logPrefix ?? '[llm]'}: screenshot transcription failed, falling back to inline: ${msg}`
    );
    return null;
  }
}

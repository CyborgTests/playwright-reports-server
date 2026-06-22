import {
  expectedStrategyCalls,
  type LlmTaskRouting,
  type LlmTaskType,
} from '@playwright-reports/shared';
import { configCache } from '../../service/cache/config.js';
import { llmTasksDb } from '../../service/db/index.js';
import { llmService, type SegmentedSendOptions } from '../index.js';
import {
  type FallbackSendResult,
  getPrimaryModelTemperature,
  sendViaModelRow,
  sendWithFallback,
} from '../registry.js';
import type { SegmentedPrompt } from '../types/index.js';
import { DEFAULT_TEMP, resolveRole, TEMP_KEY } from './shared.js';
import { runCascade, runCouncil, runFusion, runSelfRefine } from './strategies.js';

export function resolveRouting(taskType: LlmTaskType): LlmTaskRouting {
  return configCache.config?.llm?.routing?.[taskType] ?? { strategy: 'one_shot' };
}

const STRATEGIES = new Set(['one_shot', 'fusion', 'council', 'cascade', 'self_refine']);
const TASK_TYPES = new Set(['test_analysis', 'report_summary', 'project_summary']);
const ROLE_LISTS = ['authors', 'judges', 'tiers'] as const;
const ROLE_SINGLES = [
  'model',
  'synthesizer',
  'critic',
  'reviser',
  'scorer',
  'secondOpinion',
] as const;
const CASCADE_GATES = new Set(['checks', 'scorer', 'checks_and_scorer', 'disagreement']);
const REFINE_MODES = new Set(['revise', 'escalate']);

export function validateRouting(parsed: unknown, enabledModelIds: Set<string>): string | null {
  if (parsed == null || typeof parsed !== 'object') return 'routing must be an object';
  for (const [taskType, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (!TASK_TYPES.has(taskType)) return `unknown task type "${taskType}"`;
    if (raw == null || typeof raw !== 'object') return `routing.${taskType} must be an object`;
    const r = raw as Record<string, unknown>;
    if (typeof r.strategy !== 'string' || !STRATEGIES.has(r.strategy)) {
      return `routing.${taskType}.strategy is invalid`;
    }
    const refs: unknown[] = [];
    for (const key of ROLE_LISTS) {
      const v = r[key];
      if (v === undefined) continue;
      if (!Array.isArray(v)) return `routing.${taskType}.${key} must be an array`;
      refs.push(...v);
    }
    for (const key of ROLE_SINGLES) if (r[key] !== undefined) refs.push(r[key]);
    for (const ref of refs) {
      if (ref == null || typeof ref !== 'object')
        return `routing.${taskType} has an invalid model ref`;
      const rr = ref as Record<string, unknown>;
      if (rr.modelId !== undefined) {
        if (typeof rr.modelId !== 'string' || !enabledModelIds.has(rr.modelId)) {
          return `routing.${taskType} references an unknown or disabled model`;
        }
      }
      if (
        rr.temperature !== undefined &&
        (typeof rr.temperature !== 'number' || rr.temperature < 0 || rr.temperature > 2)
      ) {
        return `routing.${taskType} temperature must be between 0 and 2`;
      }
      if (rr.lens !== undefined && typeof rr.lens !== 'string') {
        return `routing.${taskType} lens must be a string`;
      }
    }
    if (
      r.minPassVotes !== undefined &&
      (typeof r.minPassVotes !== 'number' || r.minPassVotes < 1)
    ) {
      return `routing.${taskType}.minPassVotes must be ≥ 1`;
    }
    if (r.maxRounds !== undefined && (typeof r.maxRounds !== 'number' || r.maxRounds < 1)) {
      return `routing.${taskType}.maxRounds must be ≥ 1`;
    }
    if (
      r.escalateBelowScore !== undefined &&
      (typeof r.escalateBelowScore !== 'number' ||
        r.escalateBelowScore < 0 ||
        r.escalateBelowScore > 1)
    ) {
      return `routing.${taskType}.escalateBelowScore must be between 0 and 1`;
    }
    if (r.cascadeGate !== undefined && !CASCADE_GATES.has(r.cascadeGate as string)) {
      return `routing.${taskType}.cascadeGate is invalid`;
    }
    if (r.refineMode !== undefined && !REFINE_MODES.has(r.refineMode as string)) {
      return `routing.${taskType}.refineMode is invalid`;
    }
  }
  return null;
}

async function executeStrategy(
  taskId: string,
  taskType: LlmTaskType,
  prompt: SegmentedPrompt,
  options: SegmentedSendOptions,
  routing: LlmTaskRouting
): Promise<FallbackSendResult> {
  try {
    switch (routing.strategy) {
      case 'fusion':
        return await runFusion(taskId, taskType, prompt, routing);
      case 'council':
        return await runCouncil(taskId, taskType, prompt, routing);
      case 'cascade':
        return await runCascade(taskId, taskType, prompt, routing);
      case 'self_refine':
        return await runSelfRefine(taskId, taskType, prompt, routing, options);
      default:
        return await sendWithFallback(prompt, options);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[llm-routing] ${routing.strategy} failed for ${taskType}: ${msg}; falling back to one_shot`
    );
    llmTasksDb.markStrategy(taskId, 'one_shot');
    return sendWithFallback(prompt, options);
  }
}

export async function runTaskStrategy(
  taskType: LlmTaskType,
  prompt: SegmentedPrompt,
  options: SegmentedSendOptions = {},
  taskId?: string
): Promise<FallbackSendResult> {
  const routing = resolveRouting(taskType);

  if (routing.strategy === 'one_shot') {
    const override = routing.model?.modelId ? resolveRole(routing.model, taskType) : null;
    if (override) {
      if (taskId) llmTasksDb.markStrategy(taskId, 'one_shot');
      return sendViaModelRow(override.row, prompt, {
        ...options,
        temperature: override.temperature,
      });
    }
    return sendWithFallback(prompt, options);
  }

  if (!taskId) {
    return sendWithFallback(prompt, options);
  }

  llmTasksDb.markStrategy(taskId, routing.strategy);
  return executeStrategy(taskId, taskType, prompt, options, routing);
}

export async function runRoutedTask(
  taskType: LlmTaskType,
  taskId: string,
  prompt: SegmentedPrompt,
  debugPrompt: string
): Promise<FallbackSendResult> {
  const routing = resolveRouting(taskType);
  llmTasksDb.updatePrompt(
    taskId,
    debugPrompt,
    llmService.estimateLocalInputTokens(prompt) * expectedStrategyCalls(routing)
  );
  const temperature = getPrimaryModelTemperature(TEMP_KEY[taskType]) ?? DEFAULT_TEMP[taskType];
  return runTaskStrategy(taskType, prompt, { temperature }, taskId);
}

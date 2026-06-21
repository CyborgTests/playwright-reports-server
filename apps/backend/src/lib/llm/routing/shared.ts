import type { LlmRoleRef, LlmTaskType } from '@playwright-reports/shared';
import { type LlmModelRow, llmModelsDb, llmTasksDb } from '../../service/db/index.js';
import { llmService, type SegmentedSendOptions } from '../index.js';
import type { Draft } from '../prompts/routing.js';
import {
  OUTPUT_RESERVE_TOKENS_BY_TASK,
  TASK_TEMPERATURE_DEFAULTS,
} from '../queue/tasks/promptFitting.js';
import {
  type FallbackSendResult,
  type LlmTaskTemperatureKey,
  modelRowToProviderConfig,
  runOnModel,
} from '../registry.js';
import type { LLMResponse, SegmentedPrompt } from '../types/index.js';

export const TEMP_KEY: Record<LlmTaskType, LlmTaskTemperatureKey> = {
  test_analysis: 'testAnalysisTemperature',
  report_summary: 'reportSummaryTemperature',
  project_summary: 'projectSummaryTemperature',
};
export const DEFAULT_TEMP: Record<LlmTaskType, number> = {
  test_analysis: TASK_TEMPERATURE_DEFAULTS.testAnalysis,
  report_summary: TASK_TEMPERATURE_DEFAULTS.reportSummary,
  project_summary: TASK_TEMPERATURE_DEFAULTS.projectSummary,
};
export const RESERVE: Record<LlmTaskType, number> = {
  test_analysis: OUTPUT_RESERVE_TOKENS_BY_TASK.testAnalysis,
  report_summary: OUTPUT_RESERVE_TOKENS_BY_TASK.reportSummary,
  project_summary: OUTPUT_RESERVE_TOKENS_BY_TASK.projectSummary,
};
export const SCORE_RESERVE = 1500; // judge/scorer outputs are tiny JSON/MD

const VERDICT_ROLES = new Set(['scorer', 'judge']);

export interface ResolvedRole {
  row: LlmModelRow;
  isPrimary: boolean;
  temperature: number;
}

export type Usage = LLMResponse['usage'];

export function resolveRole(
  ref: LlmRoleRef | undefined,
  taskType: LlmTaskType
): ResolvedRole | null {
  const primary = llmModelsDb.getPrimary();
  const row = ref?.modelId
    ? (llmModelsDb.list().find((m) => m.id === ref.modelId && m.enabled === 1) ?? null)
    : (primary ?? null);
  if (!row) return null;
  const temperature = ref?.temperature ?? row[TEMP_KEY[taskType]] ?? DEFAULT_TEMP[taskType];
  return { row, isPrimary: primary != null && row.id === primary.id, temperature };
}

export function resolveRoles(
  refs: LlmRoleRef[] | undefined,
  taskType: LlmTaskType
): ResolvedRole[] {
  const list = (refs ?? [])
    .map((r) => resolveRole(r, taskType))
    .filter((r): r is ResolvedRole => r != null);
  if (list.length > 0) return list;
  const active = resolveRole(undefined, taskType);
  return active ? [active] : [];
}

export function sumUsage(usages: Usage[]): Usage {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  for (const u of usages) {
    inputTokens += u.inputTokens ?? 0;
    outputTokens += u.outputTokens ?? 0;
    totalTokens += u.totalTokens ?? (u.inputTokens ?? 0) + (u.outputTokens ?? 0);
  }
  return { inputTokens, outputTokens, totalTokens };
}

export async function callRole(
  taskId: string,
  taskType: LlmTaskType,
  roleName: string,
  role: ResolvedRole,
  prompt: SegmentedPrompt
): Promise<LLMResponse> {
  const opts: SegmentedSendOptions = { temperature: role.temperature };
  const childId = llmTasksDb.startRoleExecution({
    parentTaskId: taskId,
    type: taskType,
    role: roleName,
    model: role.row.model,
    baseUrl: role.row.baseUrl,
  });
  try {
    const resp = await runOnModel(
      role.row,
      () =>
        role.isPrimary
          ? llmService.sendSegmentedMessage(prompt, opts)
          : llmService.sendViaModel(modelRowToProviderConfig(role.row), prompt, opts),
      () => llmTasksDb.markRoleProcessing(childId)
    );
    if (role.row.lastError) llmModelsDb.setLastError(role.row.id, null);
    llmTasksDb.finishRoleExecution(childId, {
      status: 'completed',
      model: resp.model,
      baseUrl: role.row.baseUrl,
      usage: resp.usage,
      result: VERDICT_ROLES.has(roleName) ? resp.content : null,
    });
    return resp;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    llmModelsDb.setLastError(role.row.id, msg);
    llmTasksDb.finishRoleExecution(childId, {
      status: 'failed',
      model: role.row.model,
      baseUrl: role.row.baseUrl,
      error: msg,
    });
    throw err;
  }
}

export function parseFirstJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fence?.[1], text].filter((c): c is string => !!c);
  for (const c of candidates) {
    const trimmed = c.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      const start = trimmed.search(/[[{]/);
      const end = Math.max(trimmed.lastIndexOf(']'), trimmed.lastIndexOf('}'));
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(trimmed.slice(start, end + 1));
        } catch {
          // fall through
        }
      }
    }
  }
  return null;
}

export function fitFinal(
  response: LLMResponse,
  usages: Usage[],
  baseUrl: string
): FallbackSendResult {
  return { response: { ...response, usage: sumUsage(usages) }, baseUrl };
}

export type JudgeVerdict = { candidate?: number; pass?: boolean; score?: number };

export function coerceVerdicts(parsed: unknown): JudgeVerdict[] {
  if (Array.isArray(parsed)) return parsed as JudgeVerdict[];
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.verdicts)) return obj.verdicts as JudgeVerdict[];
    if (Array.isArray(obj.results)) return obj.results as JudgeVerdict[];
    if ('candidate' in obj || 'pass' in obj || 'score' in obj) return [obj as JudgeVerdict];
  }
  return [];
}

export async function runAuthors(
  taskId: string,
  taskType: LlmTaskType,
  prompt: SegmentedPrompt,
  authors: ResolvedRole[]
): Promise<{ drafts: Draft[]; usages: Usage[] }> {
  const settled = await Promise.allSettled(
    authors.map((role) => callRole(taskId, taskType, 'author', role, prompt))
  );
  const drafts: Draft[] = [];
  const usages: Usage[] = [];
  settled.forEach((res, i) => {
    if (res.status === 'fulfilled') {
      drafts.push({
        content: res.value.content,
        model: res.value.model,
        baseUrl: authors[i].row.baseUrl,
      });
      usages.push(res.value.usage);
    }
  });
  if (drafts.length === 0) throw new Error('all authors failed in strategy execution');
  return { drafts, usages };
}

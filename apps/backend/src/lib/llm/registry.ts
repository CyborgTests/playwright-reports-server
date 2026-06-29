import type {
  LLMMultimodalMode,
  LLMProviderType,
  LlmCircuitStatus,
  LlmModel,
} from '@playwright-reports/shared';
import { decryptToken } from '../githubSync/encryption.js';
import { configCache } from '../service/cache/config.js';
import { type LlmModelRow, llmGroupsDb, llmModelsDb } from '../service/db/index.js';
import { circuitFor, circuitStatusFor } from './circuitBreaker.js';
import { llmService, type SegmentedSendOptions } from './index.js';
import { modelGate, reservationStore } from './modelGate.js';
import {
  type LLMProviderConfig,
  LLMProviderError,
  type LLMResponse,
  type SegmentedPrompt,
} from './types/index.js';

const API_KEY_MASK = '********';

export function toLlmModel(row: LlmModelRow): LlmModel {
  return {
    id: row.id,
    label: row.label,
    provider: row.provider as LLMProviderType,
    baseUrl: row.baseUrl,
    apiKey: row.apiKeyCipher ? API_KEY_MASK : '',
    model: row.model,
    parallelRequests: row.parallelRequests,
    maxTokens: row.maxTokens ?? undefined,
    contextWindow: row.contextWindow ?? undefined,
    multimodalMode: row.multimodalMode as LLMMultimodalMode,
    testAnalysisTemperature: row.testAnalysisTemperature ?? undefined,
    reportSummaryTemperature: row.reportSummaryTemperature ?? undefined,
    projectSummaryTemperature: row.projectSummaryTemperature ?? undefined,
    inputCostPerMTok: row.inputCostPerMTok ?? undefined,
    outputCostPerMTok: row.outputCostPerMTok ?? undefined,
    sortOrder: row.sortOrder,
    isPrimary: row.isPrimary === 1,
    enabled: row.enabled === 1,
    concurrencyGroupId: row.concurrencyGroupId,
    lastTestedAt: row.lastTestedAt ?? undefined,
    lastError: row.lastError ?? undefined,
    circuit: circuitStatusFor(row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function modelRowToProviderConfig(
  row: LlmModelRow
): Pick<
  LLMProviderConfig,
  'provider' | 'baseUrl' | 'apiKey' | 'model' | 'maxTokens' | 'contextWindow' | 'multimodalMode'
> {
  return {
    provider: row.provider as LLMProviderType,
    baseUrl: row.baseUrl,
    apiKey: decryptToken(row.apiKeyCipher) ?? '',
    model: row.model,
    maxTokens: row.maxTokens ?? undefined,
    contextWindow: row.contextWindow ?? undefined,
    multimodalMode: (row.multimodalMode as LLMMultimodalMode) ?? 'auto',
  };
}

export function isLlmFeatureEnabled(): boolean {
  return configCache.config?.llm?.featureEnabled !== false;
}

export function isFallbackChainEnabled(): boolean {
  return configCache.config?.llm?.useFallbackChain === true;
}

export interface FallbackSendResult {
  response: LLMResponse;
  baseUrl: string;
}

export function resolveGate(row: LlmModelRow): { key: string; limit: number } {
  if (row.concurrencyGroupId) {
    const group = llmGroupsDb.get(row.concurrencyGroupId);
    if (group) return { key: group.id, limit: group.concurrencyLimit };
  }
  return { key: row.id, limit: row.parallelRequests };
}

export async function runOnModel<T>(
  row: LlmModelRow,
  fn: () => Promise<T>,
  onStart?: () => void
): Promise<T> {
  const breaker = circuitFor(row.id, row.label);
  if (!breaker.shouldAttempt()) {
    throw new LLMProviderError(
      `model "${row.label}" circuit open - it has been failing; retrying in ${Math.ceil(
        breaker.msUntilRetry() / 1000
      )}s`,
      'circuit_open'
    );
  }
  const guarded = async (): Promise<T> => {
    try {
      const result = await fn();
      breaker.onSuccess();
      return result;
    } catch (err) {
      breaker.onFailure(err);
      throw err;
    }
  };
  const gate = resolveGate(row);
  const held = reservationStore.getStore();
  if (held && !held.consumed && held.gateKey === gate.key) {
    held.consumed = true;
    onStart?.();
    return guarded();
  }
  return modelGate.run(gate.key, gate.limit, guarded, onStart);
}

export function anyModelCircuitAvailable(): boolean {
  const enabled = llmModelsDb.list().filter((m) => m.enabled === 1);
  if (enabled.length === 0) return true;
  return enabled.some((m) => circuitStatusFor(m.id).state !== 'open');
}

export function aggregateCircuitStatus(): LlmCircuitStatus {
  const enabled = llmModelsDb.list().filter((m) => m.enabled === 1);
  if (enabled.length === 0) return { state: 'closed', retryInMs: null };
  const statuses = enabled.map((m) => circuitStatusFor(m.id));
  if (statuses.some((s) => s.state === 'closed')) return { state: 'closed', retryInMs: null };
  const open = statuses.filter((s) => s.state === 'open');
  if (open.length > 0) {
    return { state: 'open', retryInMs: Math.min(...open.map((s) => s.retryInMs ?? 0)) };
  }
  return { state: 'half-open', retryInMs: null };
}

export interface FallbackHooks {
  onAttemptStart?: (model: LlmModelRow) => void;
  onAttemptFail?: (model: LlmModelRow, error: string) => void;
}

export async function sendWithFallback(
  prompt: SegmentedPrompt,
  options: SegmentedSendOptions = {},
  hooks?: FallbackHooks
): Promise<FallbackSendResult> {
  const primary = llmModelsDb.getPrimary();

  if (!isFallbackChainEnabled()) {
    if (primary) hooks?.onAttemptStart?.(primary);
    const send = () => llmService.sendSegmentedMessage(prompt, options);
    const response = primary ? await runOnModel(primary, send) : await send();
    return { response, baseUrl: llmService.getBaseUrl() ?? primary?.baseUrl ?? '' };
  }

  const enabled = llmModelsDb.list().filter((m) => m.enabled === 1);
  const chain = primary ? [primary, ...enabled.filter((m) => m.id !== primary.id)] : enabled;

  if (chain.length === 0) {
    const response = await llmService.sendSegmentedMessage(prompt, options);
    return { response, baseUrl: llmService.getBaseUrl() ?? '' };
  }

  let lastErr: unknown;
  for (const model of chain) {
    try {
      hooks?.onAttemptStart?.(model);
      const isPrimary = model.id === primary?.id;
      const response = await runOnModel(model, () =>
        isPrimary
          ? llmService.sendSegmentedMessage(prompt, options)
          : llmService.sendViaModel(modelRowToProviderConfig(model), prompt, options)
      );
      if (model.lastError) llmModelsDb.setLastError(model.id, null);
      return { response, baseUrl: model.baseUrl };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      llmModelsDb.setLastError(model.id, msg);
      hooks?.onAttemptFail?.(model, msg);
      console.warn(`[llm-registry] model "${model.label}" failed, trying next in chain: ${msg}`);
    }
  }
  throw lastErr ?? new Error('all models in the fallback chain failed');
}

export async function sendViaModelRow(
  row: LlmModelRow,
  prompt: SegmentedPrompt,
  options: SegmentedSendOptions = {},
  hooks?: FallbackHooks
): Promise<FallbackSendResult> {
  const primary = llmModelsDb.getPrimary();
  const isPrimary = primary?.id === row.id;
  hooks?.onAttemptStart?.(row);
  try {
    const response = await runOnModel(row, () =>
      isPrimary
        ? llmService.sendSegmentedMessage(prompt, options)
        : llmService.sendViaModel(modelRowToProviderConfig(row), prompt, options)
    );
    if (row.lastError) llmModelsDb.setLastError(row.id, null);
    return { response, baseUrl: row.baseUrl };
  } catch (err) {
    llmModelsDb.setLastError(row.id, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export type LlmTaskTemperatureKey =
  | 'testAnalysisTemperature'
  | 'reportSummaryTemperature'
  | 'projectSummaryTemperature';

export function getPrimaryModelTemperature(key: LlmTaskTemperatureKey): number | undefined {
  return llmModelsDb.getPrimary()?.[key] ?? undefined;
}

export async function applyPrimaryModel(): Promise<void> {
  const primary = llmModelsDb.getPrimary();
  if (!primary) {
    llmService.clearConfig();
    return;
  }
  llmService.applyConfig(modelRowToProviderConfig(primary));
}

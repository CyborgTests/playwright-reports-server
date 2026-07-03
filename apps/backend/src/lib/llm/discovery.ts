import type { DiscoveredModel } from '@playwright-reports/shared';

function roundCost(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  return undefined;
}

function priceToPerMTok(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return roundCost(parsed * 1e6);
}

const CONTEXT_KEYS = [
  'context_length',
  'loaded_context_length',
  'max_model_len',
  'max_context_length',
  'n_ctx',
] as const;

function extractContext(entry: Record<string, unknown>): number | undefined {
  for (const key of CONTEXT_KEYS) {
    const value = asNumber(entry[key]);
    if (value !== undefined) return value;
  }
  const topProvider = asRecord(entry.top_provider);
  if (topProvider) return asNumber(topProvider.context_length);
  return undefined;
}

function extractModality(entry: Record<string, unknown>): string | undefined {
  const architecture = asRecord(entry.architecture);
  if (!architecture) return undefined;
  const inputs = architecture.input_modalities;
  if (Array.isArray(inputs)) {
    return inputs.includes('image') ? 'text+image' : 'text';
  }
  const modality = architecture.modality;
  if (typeof modality === 'string') {
    return modality.includes('image') ? 'text+image' : 'text';
  }
  return undefined;
}

export function parseOpenAiCompatibleModels(data: unknown): DiscoveredModel[] {
  const root = asRecord(data);
  const list = Array.isArray(root?.data) ? root.data : [];
  const models: DiscoveredModel[] = [];
  for (const item of list) {
    const entry = asRecord(item);
    const id = entry && typeof entry.id === 'string' ? entry.id : null;
    if (!entry || !id) continue;

    const pricing = asRecord(entry.pricing);
    const inputCostPerMTok = pricing ? priceToPerMTok(pricing.prompt) : undefined;
    const outputCostPerMTok = pricing ? priceToPerMTok(pricing.completion) : undefined;
    const hasPricing = inputCostPerMTok !== undefined || outputCostPerMTok !== undefined;
    const isFree = id.endsWith(':free')
      ? true
      : hasPricing
        ? inputCostPerMTok === 0 && outputCostPerMTok === 0
        : undefined;

    models.push({
      id,
      name: typeof entry.name === 'string' ? entry.name : undefined,
      contextLength: extractContext(entry),
      inputCostPerMTok,
      outputCostPerMTok,
      isFree,
      modality: extractModality(entry),
    });
  }
  return models;
}

export function parseAnthropicModels(data: unknown): DiscoveredModel[] {
  const root = asRecord(data);
  const list = Array.isArray(root?.data) ? root.data : [];
  const models: DiscoveredModel[] = [];
  for (const item of list) {
    const entry = asRecord(item);
    const id = entry && typeof entry.id === 'string' ? entry.id : null;
    if (!entry || !id) continue;
    models.push({
      id,
      name: typeof entry.display_name === 'string' ? entry.display_name : undefined,
    });
  }
  return models;
}

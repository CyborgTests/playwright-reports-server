import type { LLMMultimodalMode, LLMProviderType } from '@playwright-reports/shared';

export const PROVIDERS: { key: LLMProviderType; label: string }[] = [
  { key: 'openai', label: 'OpenAI-compatible' },
  { key: 'anthropic', label: 'Anthropic' },
];
export const MULTIMODAL_MODES: LLMMultimodalMode[] = ['auto', 'force', 'disabled'];
export const TASK_TEMP_DEFAULTS = {
  testAnalysisTemperature: 0.2,
  reportSummaryTemperature: 0.3,
  projectSummaryTemperature: 0.3,
} as const;

export interface FormState {
  label: string;
  provider: LLMProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
  parallelRequests: number;
  maxTokens: string;
  contextWindow: string;
  multimodalMode: LLMMultimodalMode;
  testAnalysisTemperature: string;
  reportSummaryTemperature: string;
  projectSummaryTemperature: string;
  inputCostPerMTok: string;
  outputCostPerMTok: string;
  concurrencyGroupId: string | null;
}

export const blankForm: FormState = {
  label: '',
  provider: 'openai',
  baseUrl: '',
  apiKey: '',
  model: '',
  parallelRequests: 1,
  maxTokens: '',
  contextWindow: '',
  multimodalMode: 'auto',
  testAnalysisTemperature: '',
  reportSummaryTemperature: '',
  projectSummaryTemperature: '',
  inputCostPerMTok: '',
  outputCostPerMTok: '',
  concurrencyGroupId: null,
};

export function parsePositiveInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isNaN(n) || n <= 0 ? null : n;
}

export function parseTemperature(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number.parseFloat(trimmed);
  return Number.isNaN(n) || n < 0 || n > 2 ? null : n;
}

export function parseCost(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number.parseFloat(trimmed);
  return Number.isNaN(n) || n < 0 ? null : n;
}

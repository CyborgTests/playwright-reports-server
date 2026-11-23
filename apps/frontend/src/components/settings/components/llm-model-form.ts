import type { LLMMultimodalMode, LLMProviderType } from '@playwright-reports/shared';

export interface ProviderOption {
  key: LLMProviderType;
  label: string;
  /** Prefilled into Base URL when this provider is picked (editable). */
  defaultBaseUrl: string;
  baseUrlPlaceholder: string;
  keyPlaceholder: string;
  hint?: string;
}

export const PROVIDERS: ProviderOption[] = [
  {
    key: 'openai',
    label: 'OpenAI-compatible',
    defaultBaseUrl: '',
    baseUrlPlaceholder: 'https://openrouter.ai/api/v1 or http://localhost:1234/v1',
    keyPlaceholder: 'sk-...',
  },
  {
    key: 'anthropic',
    label: 'Anthropic',
    defaultBaseUrl: '',
    baseUrlPlaceholder: 'https://api.anthropic.com/v1',
    keyPlaceholder: 'sk-ant-...',
  },
  {
    key: 'azure-foundry',
    label: 'Azure AI Foundry',
    defaultBaseUrl: '',
    baseUrlPlaceholder: 'https://<resource>.cognitiveservices.azure.com/openai/v1',
    keyPlaceholder: 'Foundry resource key',
    hint: 'Resource endpoint (.cognitiveservices.azure.com, .openai.azure.com or .services.ai.azure.com); /openai/v1 is appended if missing. Model = Foundry deployment name, not the catalog model id.',
  },
  {
    key: 'bedrock',
    label: 'AWS Bedrock',
    defaultBaseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1',
    baseUrlPlaceholder: 'https://bedrock-runtime.<region>.amazonaws.com/openai/v1',
    keyPlaceholder: 'Bedrock API key',
    hint: 'Bedrock OpenAI-compatible endpoint; set your region in the URL. Model = Bedrock model or inference profile id (e.g. anthropic.claude-sonnet-4-5-v1:0 or global.…).',
  },
  {
    key: 'cursor',
    label: 'Cursor',
    defaultBaseUrl: 'https://api.cursor.com',
    baseUrlPlaceholder: 'https://api.cursor.com',
    keyPlaceholder: 'crsr_...',
    hint: 'Cursor Cloud Agents API: each request runs a short-lived agent, so expect 30-60s+ per analysis. Start with parallel requests = 1. Model = id from Import models (e.g. auto-smart); empty uses your Cursor default.',
  },
];

export function providerOption(key: LLMProviderType): ProviderOption {
  return PROVIDERS.find((p) => p.key === key) ?? PROVIDERS[0];
}

/** Base URL after switching provider: replace it only if empty or still the old default. */
export function baseUrlForProvider(
  current: string,
  from: LLMProviderType,
  to: LLMProviderType
): string {
  const untouched = current.trim() === '' || current === providerOption(from).defaultBaseUrl;
  return untouched ? providerOption(to).defaultBaseUrl : current;
}
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

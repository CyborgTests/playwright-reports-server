export const MIN_ESTIMATE_SAMPLES = 1;

export interface LlmDurationEstimate {
  meanMs: number;
  sampleCount: number;
}

export interface LlmEstimates {
  parents: Record<string, LlmDurationEstimate>;
  parentsByStrategy: Record<string, LlmDurationEstimate>;
  roles: Record<string, LlmDurationEstimate>;
}

const part = (value: string | null | undefined, fallback = '') => value ?? fallback;

export function parentEstimateKey(
  type: string,
  strategy: string | null | undefined,
  model: string | null | undefined,
  baseUrl: string | null | undefined
): string {
  return [type, part(strategy, 'one_shot'), part(model), part(baseUrl)].join('|');
}

export function strategyEstimateKey(type: string, strategy: string | null | undefined): string {
  return [type, part(strategy, 'one_shot')].join('|');
}

export function roleEstimateKey(
  type: string,
  strategy: string | null | undefined,
  role: string | null | undefined,
  model: string | null | undefined,
  baseUrl: string | null | undefined
): string {
  return [type, part(strategy, 'one_shot'), part(role), part(model), part(baseUrl)].join('|');
}

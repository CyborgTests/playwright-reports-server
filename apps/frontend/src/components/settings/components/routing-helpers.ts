import {
  type CascadeGate,
  type LlmRoleRef,
  type LlmScreenshotSource,
  type LlmStrategy,
  type LlmTaskRouting,
  type LlmTaskType,
  STRATEGY_LABELS,
} from '@playwright-reports/shared';

export const TASKS: { key: LlmTaskType; label: string }[] = [
  { key: 'test_analysis', label: 'Test analysis' },
  { key: 'report_summary', label: 'Report summary' },
  { key: 'project_summary', label: 'Project summary' },
];

const STRATEGY_HINTS: Record<LlmStrategy, string> = {
  one_shot: 'A single model produces the answer.',
  fusion:
    'Several models draft concurrently; a synthesizer merges them. Only helps when the authors are DIFFERENT models - identical authors share the same blind spots, so this adds cost without diversity.',
  council:
    'Several models draft; judges score them and the best-voted draft wins. Only helps with diverse authors and judges - a same-model panel mostly adds cost and is prone to self-preference.',
  cascade:
    'Try a smaller model first; escalate to a stronger tier only when the chosen gate flags the draft (deterministic checks, a model scorer, or both).',
  self_refine:
    'A draft is critiqued then rewritten for N rounds. Author, critic, and reviser can each be a different model (they default to the author).',
};

export const STRATEGIES: { key: LlmStrategy; label: string; hint: string }[] = (
  Object.keys(STRATEGY_HINTS) as LlmStrategy[]
).map((key) => ({ key, label: STRATEGY_LABELS[key], hint: STRATEGY_HINTS[key] }));

export const COST_NOTE: Partial<Record<LlmStrategy, string>> = {
  fusion: 'Makes 1 call per author + 1 synthesizer call.',
  council: 'Makes 1 call per author + 1 per judge.',
  cascade:
    'Makes 1 call per tier, plus 1 scorer call per escalation unless the gate is checks-only, until one passes.',
  self_refine: 'Makes ~2 calls per round (critique + revise).',
};

export const CASCADE_GATE_OPTIONS: { value: CascadeGate; label: string; hint: string }[] = [
  {
    value: 'checks_and_scorer',
    label: 'Checks + scorer',
    hint: 'Deterministic checks first; a passing draft is then rated by the scorer (default).',
  },
  {
    value: 'checks',
    label: 'Checks only',
    hint: 'Escalate only on machine-detectable defects. No scorer call - cheapest gate.',
  },
  {
    value: 'scorer',
    label: 'Scorer only',
    hint: 'Escalate purely on the model scorer’s rating; skip deterministic checks.',
  },
  {
    value: 'disagreement',
    label: 'Disagreement',
    hint: 'A second-opinion model answers too; escalate only when its label differs from tier-1. Best with a different-family second opinion. If it can’t produce a label, the gate falls back to the deterministic checks.',
  },
];

const MULTI_MODEL_STRATEGIES = new Set<LlmStrategy>(['fusion', 'council']);
export const SCREENSHOT_OFF = '__off__';

export const SCREENSHOT_SOURCES: { value: LlmScreenshotSource; label: string }[] = [
  { value: 'attachment', label: 'Failure screenshot' },
  { value: 'failing_action', label: 'Before & after failed action (trace)' },
  { value: 'series', label: 'Series of trace frames' },
];
export const TRACE_SOURCES: LlmScreenshotSource[] = ['failing_action', 'series'];

export interface ScreenshotCfg {
  sources: LlmScreenshotSource[];
  max: string; // input string; '' = default
  modelId: string; // '' = off
}

export type RoutingMap = Partial<Record<LlmTaskType, LlmTaskRouting>>;

const LIST_KEYS = ['authors', 'judges', 'tiers'] as const;
const SINGLE_KEYS = [
  'model',
  'synthesizer',
  'scorer',
  'critic',
  'reviser',
  'secondOpinion',
] as const;
export type RoleListKey = (typeof LIST_KEYS)[number];
export type RoleSingleKey = (typeof SINGLE_KEYS)[number];

// Per-task routing mutators/accessors, pre-bound to one task by the parent and
// handed to the per-strategy field components.
export interface RoutingControls {
  setStrategy: (strategy: LlmStrategy) => void;
  singleValue: (key: RoleSingleKey) => string;
  setSingle: (key: RoleSingleKey, value: string) => void;
  listFor: (key: RoleListKey) => LlmRoleRef[];
  setList: (key: RoleListKey, next: LlmRoleRef[]) => void;
  patch: (patch: Partial<LlmTaskRouting>) => void;
  firstAuthorValue: () => string;
  setFirstAuthor: (value: string) => void;
}

export function diversityWarning(
  cfg: LlmTaskRouting,
  primaryId: string | undefined
): string | null {
  if (!MULTI_MODEL_STRATEGIES.has(cfg.strategy)) return null;
  const ids = new Set<string>();
  const collect = (ref?: LlmRoleRef, useLens = false) => {
    const id = ref?.modelId ?? primaryId;
    if (id) ids.add(useLens && cfg.strategy === 'fusion' && ref?.lens ? `${id}::${ref.lens}` : id);
  };
  for (const r of cfg.authors?.length ? cfg.authors : [undefined]) collect(r, true);
  if (cfg.strategy === 'fusion') collect(cfg.synthesizer);
  if (cfg.strategy === 'council') {
    for (const r of cfg.judges?.length ? cfg.judges : [undefined]) collect(r);
  }
  if (ids.size >= 2) return null;
  return cfg.strategy === 'fusion'
    ? 'Every role uses the same model - the drafts and the synthesis share identical blind spots, so this only adds cost and latency. Use different models per author, or switch to One-shot.'
    : 'Every role uses the same model - authors and judges share identical blind spots (and a judge scoring its own model is self-preference-prone), so this mostly adds cost. Use different models, or switch to One-shot.';
}

function sanitizeCfg(cfg: LlmTaskRouting, modelIds: Set<string>): LlmTaskRouting {
  const c: LlmTaskRouting = { ...cfg };
  for (const k of LIST_KEYS) {
    const list = c[k];
    if (!list) continue;
    const kept = list.filter((r) => r.modelId !== undefined && modelIds.has(r.modelId));
    if (kept.length > 0) c[k] = kept;
    else delete c[k];
  }
  for (const k of SINGLE_KEYS) {
    const ref = c[k];
    if (ref?.modelId !== undefined && !modelIds.has(ref.modelId)) delete c[k];
  }
  return c;
}

export function cleanRouting(routing: RoutingMap, modelIds?: Set<string>): RoutingMap {
  const clean: RoutingMap = {};
  for (const [task, cfg] of Object.entries(routing) as [LlmTaskType, LlmTaskRouting][]) {
    if (!cfg) continue;
    if (cfg.strategy === 'one_shot') {
      const sanitized = modelIds ? sanitizeCfg(cfg, modelIds) : cfg;
      if (sanitized.model?.modelId) {
        clean[task] = { strategy: 'one_shot', model: sanitized.model };
      }
      continue;
    }
    clean[task] = modelIds ? sanitizeCfg(cfg, modelIds) : cfg;
  }
  return clean;
}

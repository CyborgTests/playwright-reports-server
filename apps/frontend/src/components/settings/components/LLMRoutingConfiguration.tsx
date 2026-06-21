import {
  type CascadeGate,
  expectedStrategyCalls,
  type LlmRoleRef,
  type LlmStrategy,
  type LlmTaskRouting,
  type LlmTaskType,
  STRATEGY_LABELS,
} from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLlmModels } from '@/hooks/useLlmModels';
import useMutation from '@/hooks/useMutation';
import { SERVER_CONFIG_KEY, useServerConfig } from '@/hooks/useServerConfig';
import { ModelRowList, ModelSelect, NumberField, PRIMARY } from './routing-role-pickers';

const TASKS: { key: LlmTaskType; label: string }[] = [
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
const STRATEGIES: { key: LlmStrategy; label: string; hint: string }[] = (
  Object.keys(STRATEGY_HINTS) as LlmStrategy[]
).map((key) => ({ key, label: STRATEGY_LABELS[key], hint: STRATEGY_HINTS[key] }));

const COST_NOTE: Partial<Record<LlmStrategy, string>> = {
  fusion: 'Makes 1 call per author + 1 synthesizer call.',
  council: 'Makes 1 call per author + 1 per judge.',
  cascade:
    'Makes 1 call per tier, plus 1 scorer call per escalation unless the gate is checks-only, until one passes.',
  self_refine: 'Makes ~2 calls per round (critique + revise).',
};

const CASCADE_GATE_OPTIONS: { value: CascadeGate; label: string; hint: string }[] = [
  {
    value: 'checks_and_scorer',
    label: 'Checks + scorer',
    hint: 'Deterministic checks first; a passing draft is then rated by the scorer (default).',
  },
  {
    value: 'checks',
    label: 'Checks only',
    hint: 'Escalate only on machine-detectable defects. No scorer call — cheapest gate.',
  },
  {
    value: 'scorer',
    label: 'Scorer only',
    hint: 'Escalate purely on the model scorer’s rating; skip deterministic checks.',
  },
];

const MULTI_MODEL_STRATEGIES = new Set<LlmStrategy>(['fusion', 'council']);

function diversityWarning(cfg: LlmTaskRouting, primaryId: string | undefined): string | null {
  if (!MULTI_MODEL_STRATEGIES.has(cfg.strategy)) return null;
  const ids = new Set<string>();
  const add = (ref?: LlmRoleRef) => {
    const id = ref?.modelId ?? primaryId;
    if (id) ids.add(id);
  };
  (cfg.authors?.length ? cfg.authors : [undefined]).forEach(add);
  if (cfg.strategy === 'fusion') add(cfg.synthesizer);
  if (cfg.strategy === 'council') (cfg.judges?.length ? cfg.judges : [undefined]).forEach(add);
  if (ids.size >= 2) return null;
  return cfg.strategy === 'fusion'
    ? 'Every role uses the same model - the drafts and the synthesis share identical blind spots, so this only adds cost and latency. Use different models per author, or switch to One-shot.'
    : 'Every role uses the same model - authors and judges share identical blind spots (and a judge scoring its own model is self-preference-prone), so this mostly adds cost. Use different models, or switch to One-shot.';
}

type RoutingMap = Partial<Record<LlmTaskType, LlmTaskRouting>>;
type RoleListKey = 'authors' | 'judges' | 'tiers';
type RoleSingleKey = 'synthesizer' | 'scorer' | 'critic' | 'reviser';

const LIST_KEYS = ['authors', 'judges', 'tiers'] as const;
const SINGLE_KEYS = ['synthesizer', 'scorer', 'critic', 'reviser'] as const;

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

function cleanRouting(routing: RoutingMap, modelIds?: Set<string>): RoutingMap {
  const clean: RoutingMap = {};
  for (const [task, cfg] of Object.entries(routing) as [LlmTaskType, LlmTaskRouting][]) {
    if (!cfg || cfg.strategy === 'one_shot') continue;
    clean[task] = modelIds ? sanitizeCfg(cfg, modelIds) : cfg;
  }
  return clean;
}

export default function LLMRoutingConfiguration({
  featureEnabled,
}: Readonly<{ featureEnabled: boolean }>) {
  const queryClient = useQueryClient();
  const { data: config } = useServerConfig();
  const { data: allModels } = useLlmModels();
  const models = useMemo(() => (allModels ?? []).filter((m) => m.enabled), [allModels]);
  const modelIds = useMemo(
    () => (allModels ? new Set(models.map((m) => m.id)) : undefined),
    [allModels, models]
  );
  const primaryId = useMemo(() => (allModels ?? []).find((m) => m.isPrimary)?.id, [allModels]);
  const [routing, setRouting] = useState<RoutingMap>({});
  const [savedRouting, setSavedRouting] = useState<RoutingMap>({});

  const dirty =
    JSON.stringify(cleanRouting(routing, modelIds)) !==
    JSON.stringify(cleanRouting(savedRouting, modelIds));

  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !config) return;
    seeded.current = true;
    const loaded = config.llm?.routing ?? {};
    setRouting(loaded);
    setSavedRouting(loaded);
  }, [config]);

  const taskRouting = (task: LlmTaskType): LlmTaskRouting =>
    routing[task] ?? { strategy: 'one_shot' };

  const patchTask = (task: LlmTaskType, patch: Partial<LlmTaskRouting>) => {
    setRouting((prev) => ({
      ...prev,
      [task]: { ...(prev[task] ?? { strategy: 'one_shot' }), ...patch },
    }));
  };

  const setStrategy = (task: LlmTaskType, strategy: LlmStrategy) => {
    setRouting((prev) => ({ ...prev, [task]: { strategy } }));
  };

  const setList = (task: LlmTaskType, key: RoleListKey, next: LlmRoleRef[]) => {
    patchTask(task, { [key]: next.length > 0 ? next : undefined });
  };

  const setSingle = (task: LlmTaskType, key: RoleSingleKey, value: string) => {
    patchTask(task, { [key]: value === PRIMARY ? undefined : { modelId: value } });
  };

  const singleValue = (task: LlmTaskType, key: RoleSingleKey): string => {
    const id = (taskRouting(task)[key] as LlmRoleRef | undefined)?.modelId;
    if (!id || (modelIds && !modelIds.has(id))) return PRIMARY;
    return id;
  };

  const firstAuthorValue = (task: LlmTaskType): string => {
    const id = taskRouting(task).authors?.[0]?.modelId;
    if (!id || (modelIds && !modelIds.has(id))) return PRIMARY;
    return id;
  };
  const setFirstAuthor = (task: LlmTaskType, value: string) =>
    setList(task, 'authors', value === PRIMARY ? [] : [{ modelId: value }]);

  const listFor = (task: LlmTaskType, key: RoleListKey): LlmRoleRef[] => {
    const list = (taskRouting(task)[key] as LlmRoleRef[] | undefined) ?? [];
    return modelIds ? list.filter((r) => r.modelId !== undefined && modelIds.has(r.modelId)) : list;
  };

  const mutation = useMutation('/api/config', {
    method: 'PATCH',
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SERVER_CONFIG_KEY] });
      setSavedRouting(routing);
      toast.success('Routing configuration saved');
    },
  });

  const save = () => {
    const formData = new FormData();
    formData.append('llmRouting', JSON.stringify(cleanRouting(routing, modelIds)));
    mutation.mutate({ body: formData });
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-semibold">Routing</h3>
        {dirty && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setRouting(savedRouting)}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button onClick={save} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save routing'}
            </Button>
          </div>
        )}
      </div>
      <div className={featureEnabled ? '' : 'opacity-50'}>
        <p className="text-sm text-muted-foreground mb-4">
          Choose how each task is produced. Various strategies can allow orchestrate several models.
          They only pay off with genuinely <span className="font-medium">different</span>
          (or stronger) models, not the same model repeated.
        </p>

        {models.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add and enable at least one model above to configure routing.
          </p>
        ) : (
          <div className="space-y-5">
            {TASKS.map((t) => {
              const cfg = taskRouting(t.key);
              const strat = STRATEGIES.find((s) => s.key === cfg.strategy);
              const warning = diversityWarning(cfg, primaryId);
              return (
                <div key={t.key} className="border rounded-md p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="font-medium">{t.label}</span>
                    <Select
                      value={cfg.strategy}
                      onValueChange={(v) => setStrategy(t.key, v as LlmStrategy)}
                    >
                      <SelectTrigger className="h-8 w-56">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STRATEGIES.map((s) => (
                          <SelectItem key={s.key} value={s.key}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {strat && (
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted-foreground">{strat.hint}</p>
                      {cfg.strategy !== 'one_shot' && (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge
                            variant="outline"
                            className="border-amber-500/40 text-amber-600 dark:text-amber-500"
                          >
                            ≈{expectedStrategyCalls(cfg)} model calls · ~
                            {expectedStrategyCalls(cfg)}× latency vs one-shot
                          </Badge>
                          {COST_NOTE[cfg.strategy] && (
                            <span className="text-muted-foreground">{COST_NOTE[cfg.strategy]}</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {cfg.strategy === 'fusion' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ModelRowList
                        rows={listFor(t.key, 'authors')}
                        models={models}
                        onChange={(next) => setList(t.key, 'authors', next)}
                        label="Authors (drafters)"
                        addLabel="Add author"
                      />
                      <ModelSelect
                        value={singleValue(t.key, 'synthesizer')}
                        models={models}
                        onChange={(v) => setSingle(t.key, 'synthesizer', v)}
                        label="Synthesizer"
                      />
                    </div>
                  )}

                  {cfg.strategy === 'council' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ModelRowList
                        rows={listFor(t.key, 'authors')}
                        models={models}
                        onChange={(next) => setList(t.key, 'authors', next)}
                        label="Authors (drafters)"
                        addLabel="Add author"
                      />
                      <ModelRowList
                        rows={listFor(t.key, 'judges')}
                        models={models}
                        onChange={(next) => setList(t.key, 'judges', next)}
                        label="Judges"
                        addLabel="Add judge"
                      />
                      <NumberField
                        value={cfg.minPassVotes}
                        onChange={(v) => patchTask(t.key, { minPassVotes: v })}
                        label="Min passing votes"
                        min={1}
                        placeholder="majority"
                      />
                    </div>
                  )}

                  {cfg.strategy === 'cascade' &&
                    (() => {
                      const gate = cfg.cascadeGate ?? 'checks_and_scorer';
                      const scorerUsed = gate !== 'checks';
                      return (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <ModelRowList
                            rows={listFor(t.key, 'tiers')}
                            models={models}
                            onChange={(next) => setList(t.key, 'tiers', next)}
                            label="Tiers (cheap → strong)"
                            addLabel="Add tier"
                            ordered
                          />
                          <div className="space-y-1.5">
                            <Label className="text-xs font-medium">Escalation gate</Label>
                            <Select
                              value={gate}
                              onValueChange={(v) =>
                                patchTask(t.key, { cascadeGate: v as CascadeGate })
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CASCADE_GATE_OPTIONS.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>
                                    {o.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                              {CASCADE_GATE_OPTIONS.find((o) => o.value === gate)?.hint}
                            </p>
                          </div>
                          {scorerUsed && (
                            <ModelSelect
                              value={singleValue(t.key, 'scorer')}
                              models={models}
                              onChange={(v) => setSingle(t.key, 'scorer', v)}
                              label="Scorer"
                            />
                          )}
                          {scorerUsed && (
                            <NumberField
                              value={cfg.escalateBelowScore}
                              onChange={(v) => patchTask(t.key, { escalateBelowScore: v })}
                              label="Escalate below score"
                              min={0}
                              max={1}
                              step={0.05}
                              placeholder="0.7"
                            />
                          )}
                        </div>
                      );
                    })()}

                  {cfg.strategy === 'self_refine' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ModelSelect
                        value={firstAuthorValue(t.key)}
                        models={models}
                        onChange={(v) => setFirstAuthor(t.key, v)}
                        label="Author"
                      />
                      <ModelSelect
                        value={singleValue(t.key, 'critic')}
                        models={models}
                        onChange={(v) => setSingle(t.key, 'critic', v)}
                        label="Critic"
                      />
                      <ModelSelect
                        value={singleValue(t.key, 'reviser')}
                        models={models}
                        onChange={(v) => setSingle(t.key, 'reviser', v)}
                        label="Reviser"
                      />
                      <NumberField
                        value={cfg.maxRounds}
                        onChange={(v) => patchTask(t.key, { maxRounds: v })}
                        label="Max rounds"
                        min={1}
                        placeholder="1"
                      />
                    </div>
                  )}

                  {warning && (
                    <p className="rounded bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
                      ⚠ {warning}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

import type { CascadeGate } from '@playwright-reports/shared';
import {
  expectedStrategyCalls,
  type LlmModel,
  type LlmStrategy,
  type LlmTaskRouting,
  SCREENSHOTS_DEFAULT_MAX,
  SCREENSHOTS_MAX_CAP,
} from '@playwright-reports/shared';
import type { Dispatch, SetStateAction } from 'react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CASCADE_GATE_OPTIONS,
  COST_NOTE,
  type RoutingControls,
  SCREENSHOT_OFF,
  SCREENSHOT_SOURCES,
  type ScreenshotCfg,
  STRATEGIES,
  TRACE_SOURCES,
} from './routing-helpers';
import { ModelRowList, ModelSelect, NumberField } from './routing-role-pickers';

interface FieldsProps {
  cfg: LlmTaskRouting;
  models: LlmModel[];
  controls: RoutingControls;
}

function OneShotFields({ models, controls }: Readonly<FieldsProps>) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ModelSelect
        value={controls.singleValue('model')}
        models={models}
        onChange={(v) => controls.setSingle('model', v)}
        label="Model"
      />
    </div>
  );
}

function FusionFields({ models, controls }: Readonly<FieldsProps>) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ModelRowList
        rows={controls.listFor('authors')}
        models={models}
        onChange={(next) => controls.setList('authors', next)}
        label="Authors (drafters)"
        addLabel="Add author"
        withLens
      />
      <ModelSelect
        value={controls.singleValue('synthesizer')}
        models={models}
        onChange={(v) => controls.setSingle('synthesizer', v)}
        label="Synthesizer"
      />
    </div>
  );
}

function CouncilFields({ cfg, models, controls }: Readonly<FieldsProps>) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ModelRowList
        rows={controls.listFor('authors')}
        models={models}
        onChange={(next) => controls.setList('authors', next)}
        label="Authors (drafters)"
        addLabel="Add author"
      />
      <ModelRowList
        rows={controls.listFor('judges')}
        models={models}
        onChange={(next) => controls.setList('judges', next)}
        label="Judges"
        addLabel="Add judge"
      />
      <NumberField
        value={cfg.minPassVotes}
        onChange={(v) => controls.patch({ minPassVotes: v })}
        label="Min passing votes"
        min={1}
        placeholder="majority"
      />
    </div>
  );
}

function CascadeFields({ cfg, models, controls }: Readonly<FieldsProps>) {
  const gate = cfg.cascadeGate ?? 'checks_and_scorer';
  const scorerUsed = gate === 'scorer' || gate === 'checks_and_scorer';
  const disagreementUsed = gate === 'disagreement';
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ModelRowList
        rows={controls.listFor('tiers')}
        models={models}
        onChange={(next) => controls.setList('tiers', next)}
        label="Tiers (cheap → strong)"
        addLabel="Add tier"
        ordered
      />
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Escalation gate</Label>
        <Select
          value={gate}
          onValueChange={(v) => controls.patch({ cascadeGate: v as CascadeGate })}
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
          value={controls.singleValue('scorer')}
          models={models}
          onChange={(v) => controls.setSingle('scorer', v)}
          label="Scorer"
        />
      )}
      {scorerUsed && (
        <NumberField
          value={cfg.escalateBelowScore}
          onChange={(v) => controls.patch({ escalateBelowScore: v })}
          label="Escalate below score"
          min={0}
          max={1}
          step={0.05}
          placeholder="0.7"
        />
      )}
      {disagreementUsed && (
        <ModelSelect
          value={controls.singleValue('secondOpinion')}
          models={models}
          onChange={(v) => controls.setSingle('secondOpinion', v)}
          label="Second opinion"
        />
      )}
    </div>
  );
}

function SelfRefineFields({ cfg, models, controls }: Readonly<FieldsProps>) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ModelSelect
        value={controls.firstAuthorValue()}
        models={models}
        onChange={(v) => controls.setFirstAuthor(v)}
        label="Author"
      />
      <ModelSelect
        value={controls.singleValue('critic')}
        models={models}
        onChange={(v) => controls.setSingle('critic', v)}
        label="Critic"
      />
      <ModelSelect
        value={controls.singleValue('reviser')}
        models={models}
        onChange={(v) => controls.setSingle('reviser', v)}
        label="Reviser"
      />
      <NumberField
        value={cfg.maxRounds}
        onChange={(v) => controls.patch({ maxRounds: v })}
        label="Max rounds"
        min={1}
        placeholder="1"
      />
      <div className="space-y-1.5 sm:col-span-2">
        <Label className="text-xs font-medium">Mode</Label>
        <Select
          value={cfg.refineMode ?? 'revise'}
          onValueChange={(v) => controls.patch({ refineMode: v as 'revise' | 'escalate' })}
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="revise">Revise (edit the draft)</SelectItem>
            <SelectItem value="escalate">Escalate (reviser re-answers from scratch)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {cfg.refineMode === 'escalate'
            ? 'On a real problem the reviser answers the original evidence fresh (critique as hints, draft not shown) - keeps a strong reviser from following a weak draft.'
            : 'The reviser edits the draft using the critique.'}
        </p>
      </div>
    </div>
  );
}

function StrategyFields(props: Readonly<FieldsProps>) {
  switch (props.cfg.strategy) {
    case 'one_shot':
      return <OneShotFields {...props} />;
    case 'fusion':
      return <FusionFields {...props} />;
    case 'council':
      return <CouncilFields {...props} />;
    case 'cascade':
      return <CascadeFields {...props} />;
    case 'self_refine':
      return <SelfRefineFields {...props} />;
    default:
      return null;
  }
}

export interface ScreenshotSlot {
  cfg: ScreenshotCfg;
  value: string;
  onChange: Dispatch<SetStateAction<ScreenshotCfg>>;
}

function ScreenshotConfig({
  cfg,
  value,
  models,
  onChange,
}: Readonly<ScreenshotSlot & { models: LlmModel[] }>) {
  return (
    <div className="border-t pt-3 space-y-3">
      <span className="text-sm font-medium">Screenshots</span>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Sources (combine any)</Label>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {SCREENSHOT_SOURCES.map((s) => (
            <Label
              key={s.value}
              className="flex cursor-pointer items-center gap-2 text-xs font-normal"
            >
              <Checkbox
                checked={cfg.sources.includes(s.value)}
                onCheckedChange={(c) =>
                  onChange((p) => ({
                    ...p,
                    sources:
                      c === true ? [...p.sources, s.value] : p.sources.filter((x) => x !== s.value),
                  }))
                }
              />
              {s.label}
            </Label>
          ))}
        </div>
      </div>
      {cfg.sources.some((s) => TRACE_SOURCES.includes(s)) && (
        <>
          <NumberField
            value={cfg.max === '' ? undefined : Number(cfg.max)}
            onChange={(v) => onChange((p) => ({ ...p, max: v == null ? '' : String(v) }))}
            label="Max screenshots"
            min={1}
            max={SCREENSHOTS_MAX_CAP}
            placeholder={String(SCREENSHOTS_DEFAULT_MAX)}
          />
          <p className="text-xs text-muted-foreground">
            Trace frames need trace recording; falls back to the failure screenshot if the trace has
            none.
          </p>
        </>
      )}
      <div className="space-y-1">
        <Label className="text-xs font-medium">Vision model</Label>
        <Select
          value={value}
          onValueChange={(v) => onChange((p) => ({ ...p, modelId: v === SCREENSHOT_OFF ? '' : v }))}
        >
          <SelectTrigger className="h-8 sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SCREENSHOT_OFF}>Off (send image inline)</SelectItem>
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Transcribes screenshots to text first, so any strategy works without a vision analysis
          model. Customize its prompt under Prompts → Routing role prompts.
        </p>
      </div>
    </div>
  );
}

interface TaskRoutingCardProps {
  label: string;
  cfg: LlmTaskRouting;
  models: LlmModel[];
  warning: string | null;
  controls: RoutingControls;
  screenshot?: ScreenshotSlot;
}

export function TaskRoutingCard({
  label,
  cfg,
  models,
  warning,
  controls,
  screenshot,
}: Readonly<TaskRoutingCardProps>) {
  const strat = STRATEGIES.find((s) => s.key === cfg.strategy);
  return (
    <div className="border rounded-md p-3 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="font-medium">{label}</span>
        <Select value={cfg.strategy} onValueChange={(v) => controls.setStrategy(v as LlmStrategy)}>
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
                ≈{expectedStrategyCalls(cfg)} model calls · ~{expectedStrategyCalls(cfg)}× latency
                vs one-shot
              </Badge>
              {COST_NOTE[cfg.strategy] && (
                <span className="text-muted-foreground">{COST_NOTE[cfg.strategy]}</span>
              )}
            </div>
          )}
        </div>
      )}

      <StrategyFields cfg={cfg} models={models} controls={controls} />

      {warning && (
        <p className="rounded bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
          ⚠ {warning}
        </p>
      )}

      {screenshot && (
        <ScreenshotConfig
          cfg={screenshot.cfg}
          value={screenshot.value}
          onChange={screenshot.onChange}
          models={models}
        />
      )}
    </div>
  );
}

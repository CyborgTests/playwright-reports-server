import type {
  LLMMultimodalMode,
  LLMProviderType,
  LlmConcurrencyGroup,
} from '@playwright-reports/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { type FormState, MULTIMODAL_MODES, PROVIDERS, TASK_TEMP_DEFAULTS } from './llm-model-form';

const NONE_GROUP = '__none__';

export function LLMModelFormDialog({
  open,
  onOpenChange,
  editingId,
  form,
  setForm,
  saving,
  onSubmit,
  groups,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingId: string | null;
  form: FormState;
  setForm: (next: FormState) => void;
  saving: boolean;
  onSubmit: () => void;
  groups: LlmConcurrencyGroup[];
}>) {
  const selectedGroup = groups.find((g) => g.id === form.concurrencyGroupId) ?? null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingId ? 'Edit model' : 'Add model'}</DialogTitle>
          <DialogDescription>
            A new model is saved as a draft. Test its connection, then enable it before it can be
            made the primary model.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="lm-label">Label</Label>
            <Input
              id="lm-label"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="e.g. Claude Opus - primary"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="lm-provider">Provider</Label>
              <Select
                value={form.provider}
                onValueChange={(v) => setForm({ ...form, provider: v as LLMProviderType })}
              >
                <SelectTrigger id="lm-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="lm-model">Model</Label>
              <Input
                id="lm-model"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="e.g. claude-opus-4-8"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="lm-base-url">Base URL</Label>
            <Input
              id="lm-base-url"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://api.anthropic.com or http://localhost:1234/v1"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lm-key">API key {editingId && '(leave blank to keep current)'}</Label>
            <Input
              id="lm-key"
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder={editingId ? '••••••••' : 'sk-...'}
            />
            <p className="text-xs text-muted-foreground">Stored encrypted at rest.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="lm-group">Concurrency group</Label>
            <Select
              value={form.concurrencyGroupId ?? NONE_GROUP}
              onValueChange={(v) =>
                setForm({ ...form, concurrencyGroupId: v === NONE_GROUP ? null : v })
              }
            >
              <SelectTrigger id="lm-group">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_GROUP}>None (use model parallel requests)</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name} (limit {g.concurrencyLimit})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Models in a group share one concurrency budget - useful when several models hit the
              same rate limit or run on the same hardware. Manage groups in the list below.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="lm-parallel">Parallel requests</Label>
              <Input
                id="lm-parallel"
                type="number"
                min={1}
                max={10}
                disabled={!!selectedGroup}
                value={form.parallelRequests}
                onChange={(e) =>
                  setForm({
                    ...form,
                    parallelRequests: Math.min(
                      10,
                      Math.max(1, Number.parseInt(e.target.value, 10) || 1)
                    ),
                  })
                }
              />
              {selectedGroup && (
                <p className="text-xs text-muted-foreground">
                  Controlled by group {selectedGroup.name} (limit {selectedGroup.concurrencyLimit})
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="lm-maxtok">Max output tokens</Label>
              <Input
                id="lm-maxtok"
                type="number"
                min={1}
                value={form.maxTokens}
                onChange={(e) => setForm({ ...form, maxTokens: e.target.value })}
                placeholder="default"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lm-ctx">Context window</Label>
              <Input
                id="lm-ctx"
                type="number"
                min={1}
                value={form.contextWindow}
                onChange={(e) => setForm({ ...form, contextWindow: e.target.value })}
                placeholder="auto"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="lm-mm">Multimodal mode</Label>
              <Select
                value={form.multimodalMode}
                onValueChange={(v) => setForm({ ...form, multimodalMode: v as LLMMultimodalMode })}
              >
                <SelectTrigger id="lm-mm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MULTIMODAL_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {mode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="lm-incost">Input cost ($/1M tok)</Label>
              <Input
                id="lm-incost"
                type="number"
                min={0}
                step="0.01"
                value={form.inputCostPerMTok}
                onChange={(e) => setForm({ ...form, inputCostPerMTok: e.target.value })}
                placeholder="optional"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lm-outcost">Output cost ($/1M tok)</Label>
              <Input
                id="lm-outcost"
                type="number"
                min={0}
                step="0.01"
                value={form.outputCostPerMTok}
                onChange={(e) => setForm({ ...form, outputCostPerMTok: e.target.value })}
                placeholder="optional"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Cost rates are for reference only - used to estimate per-task and usage costs later.
            They don't affect requests.
          </p>

          <div className="space-y-2 border-t pt-3">
            <Label className="text-sm font-medium">Temperature per task (0–2)</Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label htmlFor="lm-temp-test" className="text-xs text-muted-foreground">
                  Test analysis
                </Label>
                <Input
                  id="lm-temp-test"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={form.testAnalysisTemperature}
                  onChange={(e) => setForm({ ...form, testAnalysisTemperature: e.target.value })}
                  placeholder={String(TASK_TEMP_DEFAULTS.testAnalysisTemperature)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lm-temp-report" className="text-xs text-muted-foreground">
                  Report summary
                </Label>
                <Input
                  id="lm-temp-report"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={form.reportSummaryTemperature}
                  onChange={(e) => setForm({ ...form, reportSummaryTemperature: e.target.value })}
                  placeholder={String(TASK_TEMP_DEFAULTS.reportSummaryTemperature)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lm-temp-project" className="text-xs text-muted-foreground">
                  Project summary
                </Label>
                <Input
                  id="lm-temp-project"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={form.projectSummaryTemperature}
                  onChange={(e) => setForm({ ...form, projectSummaryTemperature: e.target.value })}
                  placeholder={String(TASK_TEMP_DEFAULTS.projectSummaryTemperature)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Applied when this is the primary model. Leave blank to use the server default.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={saving}>
            {saving ? 'Saving…' : editingId ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

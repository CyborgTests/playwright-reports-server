import type { LlmModel, LlmRoleRef } from '@playwright-reports/shared';
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const PRIMARY = '__primary__';

export function ModelRowList({
  rows,
  models,
  onChange,
  label,
  addLabel,
  ordered = false,
}: Readonly<{
  rows: LlmRoleRef[];
  models: LlmModel[];
  onChange: (next: LlmRoleRef[]) => void;
  label: string;
  addLabel: string;
  ordered?: boolean;
}>) {
  const addRow = () => {
    if (models.length > 0) onChange([...rows, { modelId: models[0].id }]);
  };
  const removeRow = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const setRowModel = (i: number, modelId: string) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, modelId } : r)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">None added, uses the primary model.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: duplicate models allowed, so position is the identity
            <div key={i} className="flex items-center gap-1.5">
              {ordered && (
                <div className="flex flex-col leading-none">
                  <button
                    type="button"
                    aria-label="Move up"
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    disabled={i === rows.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>
              )}
              {ordered && (
                <span className="w-4 text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
              )}
              <Select value={r.modelId} onValueChange={(v) => setRowModel(i, v)}>
                <SelectTrigger className="h-8 flex-1">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                aria-label="Remove model"
                onClick={() => removeRow(i)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7"
        onClick={addRow}
        disabled={models.length === 0}
      >
        <Plus className="h-3 w-3 mr-1" />
        {addLabel}
      </Button>
    </div>
  );
}

export function ModelSelect({
  value,
  models,
  onChange,
  label,
}: Readonly<{
  value: string;
  models: LlmModel[];
  onChange: (value: string) => void;
  label: string;
}>) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PRIMARY}>Primary model (default)</SelectItem>
          {models.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function NumberField({
  value,
  onChange,
  label,
  min,
  max,
  step,
  placeholder,
}: Readonly<{
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  label: string;
  min: number;
  max?: number;
  step?: number;
  placeholder: string;
}>) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      <Input
        type="number"
        className="h-8 w-32"
        min={min}
        max={max}
        step={step}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value.trim();
          onChange(v === '' ? undefined : Number(v));
        }}
      />
    </div>
  );
}

import type { Grade, GradeFormula, QualityDashboard } from '@playwright-reports/shared';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface DashboardMetaFormProps {
  dashboard: QualityDashboard;
  onChange: (next: QualityDashboard) => void;
  onDelete: () => void;
}

export function DashboardMetaForm({ dashboard, onChange, onDelete }: DashboardMetaFormProps) {
  const patch = (changes: Partial<QualityDashboard>) => onChange({ ...dashboard, ...changes });
  const bands = dashboard.defaultGradeBands;

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Dashboard settings</h3>
          <p className="text-xs text-muted-foreground">
            Defaults inherited by every node unless overridden individually.
          </p>
        </div>
        <Button variant="destructive" size="sm" onClick={onDelete}>
          Delete dashboard
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="meta-name">Name</Label>
          <Input
            id="meta-name"
            value={dashboard.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="meta-stale">Staleness threshold (days)</Label>
          <Input
            id="meta-stale"
            type="number"
            min={0}
            max={365}
            value={dashboard.stalenessDays}
            onChange={(e) => patch({ stalenessDays: Number(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label htmlFor="meta-formula">Default formula</Label>
          <Select
            value={dashboard.defaultFormula}
            onValueChange={(v) => patch({ defaultFormula: v as GradeFormula })}
          >
            <SelectTrigger id="meta-formula">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lenient">Lenient (flakes count as pass)</SelectItem>
              <SelectItem value="strict">Strict (flakes count as fail)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="meta-minok">Default min OK grade</Label>
          <Select
            value={dashboard.defaultMinOkGrade}
            onValueChange={(v) => patch({ defaultMinOkGrade: v as Grade })}
          >
            <SelectTrigger id="meta-minok">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['S', 'A', 'B', 'C', 'D', 'F'] as const).map((g) => (
                <SelectItem key={g} value={g}>
                  {g} or better
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label>Default grade bands</Label>
        <div className="mt-2 grid grid-cols-5 gap-2">
          {(['S', 'A', 'B', 'C', 'D'] as const).map((g) => (
            <div key={g}>
              <Label htmlFor={`meta-band-${g}`} className="text-xs">
                {g} ≥
              </Label>
              <Input
                id={`meta-band-${g}`}
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={bands[g]}
                onChange={(e) =>
                  patch({
                    defaultGradeBands: { ...bands, [g]: Number(e.target.value) || 0 },
                  })
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-2 text-sm">
        <Checkbox
          id="meta-default"
          checked={dashboard.isDefault}
          onCheckedChange={(v) => patch({ isDefault: v === true })}
        />
        <div>
          <Label htmlFor="meta-default" className="cursor-pointer">
            Show on home page
          </Label>
          <p className="text-xs text-muted-foreground">
            Pinned dashboards appear stacked on `/`. Reorder them from the home page.
          </p>
        </div>
      </div>
    </div>
  );
}

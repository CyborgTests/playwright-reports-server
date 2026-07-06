import type { QualityDashboardSummary } from '@playwright-reports/shared';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface DashboardSelectorProps {
  dashboards: QualityDashboardSummary[];
  currentSlug: string | undefined;
  onSelect: (slug: string) => void;
  onCreate?: () => void;
}

export function DashboardSelector({
  dashboards,
  currentSlug,
  onSelect,
  onCreate,
}: DashboardSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <Select
        value={currentSlug ?? ''}
        onValueChange={(v) => {
          if (v === '__create__') {
            onCreate?.();
            return;
          }
          onSelect(v);
        }}
      >
        <SelectTrigger className="min-w-[12rem]">
          <SelectValue placeholder="Select dashboard" />
        </SelectTrigger>
        <SelectContent>
          {dashboards.map((d) => (
            <SelectItem key={d.id} value={d.slug}>
              <span className="inline-flex items-center gap-2">
                {d.name}
                {d.isDefault && (
                  <span className="text-[10px] uppercase text-muted-foreground">default</span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {onCreate && (
        <Button variant="outline" size="sm" onClick={onCreate} className="gap-1">
          <Plus className="h-4 w-4" />
          New
        </Button>
      )}
    </div>
  );
}

import { AlertOctagon, AlertTriangle, FileX2 } from 'lucide-react';
import type { ComponentType } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type StatusBadgeKind = 'notOk' | 'stale' | 'noData' | 'noReports';

interface StatusConfig {
  variant: 'failure' | 'warning' | 'outline';
  icon: ComponentType<{ className?: string }>;
  label: string;
  tooltip: string;
}

const CONFIG: Record<StatusBadgeKind, StatusConfig> = {
  notOk: {
    variant: 'failure',
    icon: AlertOctagon,
    label: 'Not OK',
    tooltip: 'Grade is below the configured min-OK threshold.',
  },
  stale: {
    variant: 'warning',
    icon: AlertTriangle,
    label: 'Stale',
    tooltip: 'Latest report is older than the staleness threshold.',
  },
  noData: {
    variant: 'outline',
    icon: FileX2,
    label: 'No data',
    tooltip: 'No projects configured yet — add some in Edit mode.',
  },
  noReports: {
    variant: 'outline',
    icon: FileX2,
    label: 'No reports yet',
    tooltip: 'Upload a Playwright report for this project to start grading.',
  },
};

interface StatusBadgeProps {
  status: StatusBadgeKind;
  detail?: string;
  className?: string;
}

export function StatusBadge({ status, detail, className }: StatusBadgeProps) {
  const cfg = CONFIG[status];
  const Icon = cfg.icon;
  const title = detail ? `${cfg.tooltip} ${detail}` : cfg.tooltip;
  return (
    <Badge variant={cfg.variant} className={cn('gap-1 uppercase', className)} title={title}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

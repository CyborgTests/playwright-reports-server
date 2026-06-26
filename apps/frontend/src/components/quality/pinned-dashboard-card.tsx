import type { QualityDashboardSnapshot } from '@playwright-reports/shared';
import { ChevronDown, ChevronRight, ChevronUp, Pencil } from 'lucide-react';
import { useState } from 'react';
import { GradeBadge } from '@/components/quality/grade-badge';
import { PassRateBar } from '@/components/quality/pass-rate-bar';
import { SnapshotTree } from '@/components/quality/snapshot-tree';
import {
  CARD_BORDER_CLASS,
  dotForStatus,
  STATUS_LABEL,
  worstStatus,
} from '@/components/quality/status';
import { StatusBadge } from '@/components/quality/status-badge';
import { TrendArrow } from '@/components/quality/trend-arrow';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PinnedDashboardCardProps {
  snapshot: QualityDashboardSnapshot;
  onEdit?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}

export function PinnedDashboardCard({
  snapshot,
  onEdit,
  onMoveUp,
  onMoveDown,
}: PinnedDashboardCardProps) {
  const [open, setOpen] = useState(true);
  const { dashboard, root } = snapshot;
  const status = worstStatus(root);
  const childCount = root.children?.length ?? 0;

  return (
    <section
      className={cn(
        'group rounded-md border border-l-4 bg-card shadow-sm transition-shadow',
        CARD_BORDER_CLASS[status]
      )}
    >
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent"
          aria-label={open ? 'Collapse dashboard' : 'Expand dashboard'}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {root.empty ? (
          <span
            className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-muted text-base font-bold text-muted-foreground ring-1 ring-muted-foreground/20"
            title="No data - add projects or upload reports."
          >
            -
          </span>
        ) : (
          <GradeBadge
            grade={root.grade}
            size="md"
            dot={dotForStatus(status)}
            statusLabel={STATUS_LABEL[status]}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-bold">{dashboard.name}</h2>
            {root.empty && <StatusBadge status="noData" />}
            {status === 'notOk' && !root.empty && <StatusBadge status="notOk" />}
          </div>
          {root.empty ? (
            <p className="text-xs text-muted-foreground">
              Add projects or upload reports to start grading.
            </p>
          ) : (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <PassRateBar
                passRate={root.passRate}
                bands={root.bandsUsed}
                minOkGrade={root.minOkGrade}
                className="min-w-[12rem] max-w-[20rem] flex-1"
              />
              <TrendArrow
                trend={root.trend}
                currentPassRate={root.passRate}
                previousPassRate={root.previousPassRate}
              />
              <span className="text-xs text-muted-foreground">
                {childCount} top-level node{childCount === 1 ? '' : 's'}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Button
            size="icon"
            variant="ghost"
            onClick={onMoveUp}
            disabled={!onMoveUp}
            aria-label="Move dashboard up"
            title="Move up"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onMoveDown}
            disabled={!onMoveDown}
            aria-label="Move dashboard down"
            title="Move down"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          {onEdit && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          )}
        </div>
      </header>
      <div className={cn('px-4 py-4', !open && 'hidden')}>
        <SnapshotTree root={root} />
      </div>
    </section>
  );
}

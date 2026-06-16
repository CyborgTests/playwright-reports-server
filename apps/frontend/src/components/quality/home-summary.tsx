import type { QualityDashboardSnapshot } from '@playwright-reports/shared';
import { formatRelativeTime } from '@playwright-reports/shared';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

import { aggregateHome, type WorstStatus } from './status';

interface HomeSummaryProps {
  snapshots: QualityDashboardSnapshot[];
}

const BORDER_CLASS: Record<WorstStatus, string> = {
  ok: 'border-l-emerald-500',
  stale: 'border-l-amber-500',
  notOk: 'border-l-red-500',
  empty: 'border-l-muted-foreground/40',
};

export function HomeSummary({ snapshots }: HomeSummaryProps) {
  const agg = aggregateHome(snapshots);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  void tick;

  if (snapshots.length === 0) return null;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-l-4 bg-card px-4 py-2 text-sm shadow-sm',
        BORDER_CLASS[agg.worst]
      )}
    >
      <Stat value={agg.dashboards} label={agg.dashboards === 1 ? 'dashboard' : 'dashboards'} />
      <Sep />
      <Stat value={agg.projects} label={agg.projects === 1 ? 'project' : 'projects'} />
      {agg.ok > 0 && (
        <>
          <Sep />
          <Stat value={agg.ok} label="OK" tone="ok" />
        </>
      )}
      {agg.stale > 0 && (
        <>
          <Sep />
          <Stat value={agg.stale} label="stale" tone="warn" />
        </>
      )}
      {agg.notOk > 0 && (
        <>
          <Sep />
          <Stat value={agg.notOk} label="not OK" tone="fail" />
        </>
      )}
      {agg.noData > 0 && (
        <>
          <Sep />
          <Stat value={agg.noData} label="no data" tone="muted" />
        </>
      )}
      <span
        className="ml-auto text-xs text-muted-foreground"
        title={agg.newestComputedAt ? `Latest snapshot: ${agg.newestComputedAt}` : undefined}
      >
        updated {agg.newestComputedAt ? formatRelativeTime(agg.newestComputedAt) : 'just now'}
      </span>
    </div>
  );
}

function Sep() {
  return <span className="text-muted-foreground/40">·</span>;
}

const TONE_CLASS = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  fail: 'text-red-600 dark:text-red-400',
  muted: 'text-muted-foreground',
} as const;

function Stat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: keyof typeof TONE_CLASS;
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span
        className={cn('font-semibold tabular-nums', tone ? TONE_CLASS[tone] : 'text-foreground')}
      >
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

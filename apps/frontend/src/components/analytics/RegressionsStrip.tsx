import type { RegressionsAggregate } from '@playwright-reports/shared';
import { AlertOctagon, CheckCircle2 } from 'lucide-react';

interface RegressionsStripProps {
  regressions?: RegressionsAggregate;
  isLoading?: boolean;
  onActiveClick?: () => void;
  onNewClick?: () => void;
  onResolvedClick?: () => void;
  activeFilter?: 'active' | 'new' | 'resolved' | null;
}

function formatMttr(days: number | null): string {
  if (days === null) return '—';
  if (days < 1) return `${Math.round(days * 24)}h`;
  return `${Math.round(days * 10) / 10}d`;
}

export function RegressionsStrip({
  regressions,
  isLoading,
  onActiveClick,
  onNewClick,
  onResolvedClick,
  activeFilter,
}: Readonly<RegressionsStripProps>) {
  if (isLoading || !regressions) return null;
  const { active, newInWindow, resolvedInWindow, medianMttrDays } = regressions;
  const allClear = active === 0 && newInWindow === 0 && resolvedInWindow === 0;
  const LeadingDivider = (
    <div className="shrink-0 h-5 w-px bg-border/60 ml-6 mr-3" aria-hidden="true" />
  );
  if (allClear) {
    return (
      <>
        {LeadingDivider}
        <div
          className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0"
          title="No regression activity in the selected window"
        >
          <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
          <span className="uppercase tracking-wide font-medium">Regressions</span>
          <span>none</span>
        </div>
      </>
    );
  }

  return (
    <>
      {LeadingDivider}
      <div className="flex items-center gap-1.5 text-xs">
        <div className="flex items-center gap-1.5 text-muted-foreground font-medium uppercase tracking-wide shrink-0">
          {active > 0 ? (
            <AlertOctagon className="h-3.5 w-3.5 text-danger" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
          )}
          Regressions
        </div>
        <Pill
          label="Active"
          value={active}
          variant={active > 0 ? 'danger' : 'muted'}
          onClick={active > 0 ? onActiveClick : undefined}
          selected={activeFilter === 'active'}
          title={
            activeFilter === 'active'
              ? 'Filter applied — click to clear.'
              : 'Unresolved regression in the selected window - click to filter Tests.'
          }
        />
        <Pill
          label="New"
          value={newInWindow}
          variant={newInWindow > 0 ? 'danger' : 'muted'}
          onClick={newInWindow > 0 ? onNewClick : undefined}
          selected={activeFilter === 'new'}
          title={
            activeFilter === 'new'
              ? 'Filter applied - click to clear.'
              : 'New regressions in the window - click to filter Tests.'
          }
        />
        <Pill
          label="Resolved"
          value={resolvedInWindow}
          variant={resolvedInWindow > 0 ? 'success' : 'muted'}
          onClick={resolvedInWindow > 0 ? onResolvedClick : undefined}
          selected={activeFilter === 'resolved'}
          title={
            activeFilter === 'resolved'
              ? 'Filter applied - click to clear.'
              : 'Regressions resolved in the window - click to filter Tests.'
          }
        />
        <Pill
          label="MTTR"
          value={formatMttr(medianMttrDays)}
          variant="muted"
          title="Median Time To Recovery - typical regression duration in the window (lower is better)"
        />
      </div>
    </>
  );
}

interface PillProps {
  label: string;
  value: number | string;
  variant: 'danger' | 'success' | 'muted';
  onClick?: () => void;
  title: string;
  selected?: boolean;
}

function Pill({ label, value, variant, onClick, title, selected }: Readonly<PillProps>) {
  const valueClass =
    variant === 'danger'
      ? 'text-danger'
      : variant === 'success'
        ? 'text-success'
        : 'text-foreground';
  const baseClass =
    'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 whitespace-nowrap shrink-0';
  const selectedClass = selected ? 'bg-accent ring-1 ring-foreground/20' : 'hover:bg-accent';
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-pressed={selected}
        className={`${baseClass} ${selectedClass} cursor-pointer transition-colors`}
      >
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-semibold ${valueClass}`}>{value}</span>
      </button>
    );
  }
  return (
    <span title={title} className={baseClass}>
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${valueClass}`}>{value}</span>
    </span>
  );
}

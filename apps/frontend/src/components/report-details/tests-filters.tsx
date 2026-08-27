import type { ReportHistory, ReportTestOutcome } from '@playwright-reports/shared';
import { countOutcomes } from '@playwright-reports/shared';
import { Search, X } from 'lucide-react';
import { type FC, useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { filterReportHistory } from '@/lib/transformers';
import { cn } from '@/lib/utils';

type ReportFiltersProps = {
  report: ReportHistory;
  onChangeFilters: (report: ReportHistory) => void;
};

const STATUSES = [
  {
    outcome: 'unexpected',
    label: 'failed',
    active: 'border border-danger/30 bg-danger-50 text-danger-900',
  },
  {
    outcome: 'flaky',
    label: 'flaky',
    active: 'border border-warning/30 bg-warning-50 text-warning-900',
  },
  {
    outcome: 'expected',
    label: 'passed',
    active: 'border border-success/30 bg-success-50 text-success-900',
  },
  {
    outcome: 'skipped',
    label: 'skipped',
    active: 'border border-transparent bg-secondary text-secondary-foreground',
  },
] as const;

const ALL_OUTCOMES: ReportTestOutcome[] = STATUSES.map((status) => status.outcome);

const ReportFilters: FC<ReportFiltersProps> = ({ report, onChangeFilters }) => {
  const [byName, setByName] = useState('');
  const [byOutcomes, setByOutcomes] = useState<ReportTestOutcome[]>(ALL_OUTCOMES);

  // Counts come from the unfiltered report, so the chips stay stable as you filter.
  const counts = useMemo(
    () =>
      countOutcomes((report.files ?? []).flatMap((file) => file.tests ?? []).map((t) => t.outcome)),
    [report.files]
  );

  const currentState = useMemo(
    () => filterReportHistory(report, { search: byName, status: byOutcomes }),
    [byName, byOutcomes, report]
  );

  useEffect(() => {
    onChangeFilters(currentState);
  }, [currentState, onChangeFilters]);

  const visibleStatuses = STATUSES.filter((status) => counts[status.outcome] > 0);

  const toggle = (outcome: ReportTestOutcome) => {
    const next = byOutcomes.includes(outcome)
      ? byOutcomes.filter((entry) => entry !== outcome)
      : [...byOutcomes, outcome];
    const keptVisible = visibleStatuses.some((status) => next.includes(status.outcome));
    setByOutcomes(keptVisible ? next : ALL_OUTCOMES);
  };

  const isFiltered = byName !== '' || byOutcomes.length !== ALL_OUTCOMES.length;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Filter tests by title, file path, tag or annotation"
          value={byName}
          onChange={(event) => setByName(event.target.value)}
          placeholder="Title, tag, annotation…"
          className="h-8 w-56 pl-7 text-sm"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {visibleStatuses.map((status) => {
          const on = byOutcomes.includes(status.outcome);
          return (
            <button
              key={status.outcome}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(status.outcome)}
              className={cn(
                'rounded-md px-2 py-0.5 text-xs font-semibold transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                on
                  ? status.active
                  : 'border border-dashed border-muted-foreground/40 text-muted-foreground hover:text-foreground'
              )}
            >
              {counts[status.outcome]} {status.label}
            </button>
          );
        })}
      </div>

      <span className="text-xs text-muted-foreground">
        {currentState.testCount}/{currentState.totalTestCount} shown
      </span>

      {isFiltered && (
        <button
          type="button"
          onClick={() => {
            setByName('');
            setByOutcomes(ALL_OUTCOMES);
          }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Reset
        </button>
      )}
    </div>
  );
};

export default ReportFilters;

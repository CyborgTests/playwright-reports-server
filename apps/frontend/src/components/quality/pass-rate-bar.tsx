import type { Grade, GradeBands } from '@playwright-reports/shared';
import { formatPassRate, gradeFor } from '@playwright-reports/shared';

import { cn } from '@/lib/utils';

interface PassRateBarProps {
  passRate: number;
  bands: GradeBands;
  minOkGrade: Grade;
  size?: 'sm' | 'md';
  className?: string;
}

const FILL_CLASS: Record<Grade, string> = {
  S: 'bg-emerald-500',
  A: 'bg-green-500',
  B: 'bg-lime-500',
  C: 'bg-amber-500',
  D: 'bg-orange-500',
  F: 'bg-red-600',
};

function thresholdFor(grade: Grade, bands: GradeBands): number {
  switch (grade) {
    case 'S':
      return bands.S;
    case 'A':
      return bands.A;
    case 'B':
      return bands.B;
    case 'C':
      return bands.C;
    case 'D':
      return bands.D;
    case 'F':
      return 0;
  }
}

export function PassRateBar({
  passRate,
  bands,
  minOkGrade,
  size = 'md',
  className,
}: PassRateBarProps) {
  const clamped = Math.max(0, Math.min(100, passRate));
  const grade = gradeFor(clamped, bands);
  const threshold = thresholdFor(minOkGrade, bands);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className={cn(
          'relative flex-1 overflow-hidden rounded-full bg-muted/60',
          size === 'sm' ? 'h-1.5' : 'h-2'
        )}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        aria-label={`Pass rate ${formatPassRate(clamped)}, threshold ${threshold}%`}
      >
        <div
          className={cn('h-full rounded-full transition-all', FILL_CLASS[grade])}
          style={{ width: `${clamped}%` }}
        />
        {threshold > 0 && threshold < 100 && (
          <div
            className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-foreground/50"
            style={{ left: `${threshold}%` }}
            title={`Min OK grade ${minOkGrade} ≥ ${threshold}%`}
          />
        )}
      </div>
      <span
        className={cn('tabular-nums text-muted-foreground', size === 'sm' ? 'text-xs' : 'text-sm')}
      >
        {formatPassRate(clamped)}
      </span>
    </div>
  );
}

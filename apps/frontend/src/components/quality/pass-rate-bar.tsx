import type { Grade, GradeBands } from '@playwright-reports/shared';
import { formatPassRate, gradeFor } from '@playwright-reports/shared';

import { cn } from '@/lib/utils';
import { GRADE_BG } from './grade-badge';

interface PassRateBarProps {
  passRate: number;
  bands: GradeBands;
  minOkGrade: Grade;
  size?: 'sm' | 'md';
  className?: string;
}

function thresholdFor(grade: Grade, bands: GradeBands): number {
  return grade === 'F' ? 0 : bands[grade];
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
          className={cn('h-full rounded-full transition-all', GRADE_BG[grade])}
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

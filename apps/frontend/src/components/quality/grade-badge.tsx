import type { Grade } from '@playwright-reports/shared';
import { cn } from '@/lib/utils';

// Literal class strings - Tailwind only emits classes it can see as whole tokens.
export const GRADE_BG: Record<Grade, string> = {
  S: 'bg-emerald-500',
  A: 'bg-green-500',
  B: 'bg-lime-500',
  C: 'bg-amber-500',
  D: 'bg-orange-500',
  F: 'bg-red-600',
};

const GRADE_TEXT_RING: Record<Grade, string> = {
  S: 'text-emerald-50 ring-emerald-400/30',
  A: 'text-green-50 ring-green-400/30',
  B: 'text-lime-50 ring-lime-400/30',
  C: 'text-amber-50 ring-amber-400/30',
  D: 'text-orange-50 ring-orange-400/30',
  F: 'text-red-50 ring-red-500/30',
};

const SIZE_CLASS = {
  sm: 'h-6 w-6 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-12 w-12 text-lg',
};

const DOT_SIZE_CLASS = {
  sm: 'h-1.5 w-1.5 -right-0.5 -top-0.5',
  md: 'h-2 w-2 -right-0.5 -top-0.5',
  lg: 'h-2.5 w-2.5 -right-1 -top-1',
};

type DotStatus = 'ok' | 'warn' | 'fail';

const DOT_CLASS: Record<DotStatus, string> = {
  ok: 'bg-emerald-400 ring-card',
  warn: 'bg-amber-400 ring-card',
  fail: 'bg-red-500 ring-card',
};

const DOT_LABEL: Record<DotStatus, string> = {
  ok: 'OK',
  warn: 'Stale',
  fail: 'Not OK',
};

export interface GradeBadgeProps {
  grade: Grade;
  size?: 'sm' | 'md' | 'lg';
  dot?: DotStatus;
  statusLabel?: string;
  className?: string;
}

export function GradeBadge({ grade, size = 'md', dot, statusLabel, className }: GradeBadgeProps) {
  const tooltip = statusLabel
    ? `Grade ${grade} - ${statusLabel}`
    : dot
      ? `Grade ${grade} - ${DOT_LABEL[dot]}`
      : `Grade ${grade}`;

  return (
    <span className={cn('relative inline-flex', className)} title={tooltip}>
      <span
        role="img"
        className={cn(
          'inline-flex items-center justify-center rounded-md font-bold ring-1',
          GRADE_BG[grade],
          GRADE_TEXT_RING[grade],
          SIZE_CLASS[size]
        )}
        aria-label={tooltip}
      >
        {grade}
      </span>
      {dot && (
        <span
          className={cn('absolute rounded-full ring-2', DOT_SIZE_CLASS[size], DOT_CLASS[dot])}
          aria-hidden="true"
        />
      )}
    </span>
  );
}

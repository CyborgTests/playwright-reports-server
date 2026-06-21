import type { Trend } from '@playwright-reports/shared';
import { formatPassRate } from '@playwright-reports/shared';
import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react';

import { cn } from '@/lib/utils';

interface TrendArrowProps {
  trend: Trend | undefined;
  currentPassRate: number;
  previousPassRate: number | undefined;
  className?: string;
}

export function TrendArrow({
  trend,
  currentPassRate,
  previousPassRate,
  className,
}: TrendArrowProps) {
  if (!trend || previousPassRate === undefined) return null;
  const delta = currentPassRate - previousPassRate;
  const arrow = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : ArrowRight;
  const Arrow = arrow;
  const color =
    trend === 'up'
      ? 'text-emerald-600 dark:text-emerald-400'
      : trend === 'down'
        ? 'text-red-600 dark:text-red-400'
        : 'text-muted-foreground';

  const sign = delta > 0 ? '+' : '';
  const label =
    trend === 'flat'
      ? 'flat vs previous run'
      : `${sign}${formatPassRate(delta).replace('%', '')}pp vs previous run`;

  return (
    <span
      className={cn('inline-flex items-center gap-0.5 text-xs', color, className)}
      title={`Previous: ${formatPassRate(previousPassRate)} - ${label}`}
    >
      <Arrow className="h-3 w-3" />
      {trend !== 'flat' && (
        <span className="tabular-nums">
          {sign}
          {Math.abs(delta).toFixed(1)}pp
        </span>
      )}
    </span>
  );
}

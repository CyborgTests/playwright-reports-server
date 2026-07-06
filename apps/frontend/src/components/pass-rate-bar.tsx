import type { ReportStats } from '@playwright-reports/shared';
import { type FC, memo } from 'react';
import { passRateVariant } from '@/lib/pass-rate';
import { cn } from '@/lib/utils';

type PassRateBarProps = {
  stats: ReportStats;
  className?: string;
};

const PassRateBarImpl: FC<PassRateBarProps> = ({ stats, className }) => {
  if (!stats?.total) return null;

  const denominator = stats.total - (stats.skipped || 0);
  const passedPercentage = denominator > 0 ? ((stats.expected || 0) / denominator) * 100 : 0;
  const variant = passRateVariant(passedPercentage);

  const fillClass =
    variant === 'success' ? 'bg-success' : variant === 'warning' ? 'bg-warning' : 'bg-danger';
  const textClass =
    variant === 'success' ? 'text-success' : variant === 'warning' ? 'text-warning' : 'text-danger';

  return (
    <div className={cn('flex items-center gap-2 min-w-[110px]', className)}>
      <div
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Passed percentage"
        aria-valuenow={Math.round(passedPercentage)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn('h-full rounded-full transition-all duration-300 ease-out', fillClass)}
          style={{ width: `${passedPercentage}%` }}
        />
      </div>
      <span className={cn('text-xs font-medium tabular-nums', textClass)}>
        {Math.round(passedPercentage)}%
      </span>
    </div>
  );
};

const PassRateBar = memo(PassRateBarImpl);
export default PassRateBar;

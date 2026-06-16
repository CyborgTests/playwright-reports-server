import type { ReportStats } from '@playwright-reports/shared';
import type { FC } from 'react';
import { passRateVariant } from '@/lib/pass-rate';
import { CircularProgress } from './ui/progress';

type ReportFiltersProps = {
  stats: ReportStats;
};

const InlineStatsCircle: FC<ReportFiltersProps> = ({ stats }) => {
  if (!stats.total) return null;

  const denominator = stats.total - (stats.skipped || 0);
  const passedPercentage = denominator > 0 ? ((stats.expected || 0) / denominator) * 100 : 0;
  const variant = passRateVariant(passedPercentage);

  return (
    <CircularProgress
      aria-label="Passed Percentage"
      showValueLabel={true}
      size={48}
      strokeWidth={3}
      value={Math.round(passedPercentage)}
      stroke={`hsl(var(--${variant}))`}
    />
  );
};

export default InlineStatsCircle;

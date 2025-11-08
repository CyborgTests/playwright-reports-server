'use client';

import { FC } from 'react';
import { CircularProgress } from '@heroui/react';

import { type ReportStats } from '@/app/lib/parser/types';

type ReportFiltersProps = {
  stats: ReportStats;
};

const InlineStatsCircle: FC<ReportFiltersProps> = ({ stats }) => {
  if (!stats.total) return null;

  const passedPercentage = (stats.expected / (stats.total - stats.skipped)) * 100;

  return (
    <CircularProgress
      aria-label="Passed Percentage"
      classNames={{
        value: 'text-[12px]',
      }}
      color="success"
      disableAnimation={true}
      formatOptions={{ style: 'unit', unit: 'percent' }}
      showValueLabel={true}
      size="lg"
      strokeWidth={3}
      value={Math.round(passedPercentage)}
    />
  );
};

export default InlineStatsCircle;

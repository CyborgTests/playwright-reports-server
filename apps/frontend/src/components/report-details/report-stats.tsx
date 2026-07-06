import type { ReportStats } from '@playwright-reports/shared';
import type { FC } from 'react';
import { StatChart } from '@/components/stat-chart';
import { pluralize } from '@/lib/transformers';

interface StatisticsProps {
  stats?: ReportStats;
}

const ReportStatistics: FC<StatisticsProps> = ({ stats }) => {
  if (!stats || Object.keys(stats).length === 0) {
    return <div>No statistics available</div>;
  }

  // Transform ReportStats to match StatChart interface
  const chartStats = {
    total: stats.total || 0,
    expected: stats.expected || 0,
    unexpected: stats.unexpected || 0,
    flaky: stats.flaky || 0,
    skipped: stats.skipped || 0,
    ok: stats.ok !== false, // default to true unless explicitly false
  };

  return (
    <div className="min-w-[400px] min-h-max">
      <h2 className="text-center">
        Total: {stats.total || 0} {pluralize(stats.total || 0, 'test')}
      </h2>
      <StatChart stats={chartStats} />
    </div>
  );
};

export default ReportStatistics;

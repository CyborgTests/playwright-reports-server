import { FC } from 'react';

import { StatChart } from '../stat-chart';

import { type ReportStats } from '@/app/lib/parser';
import { pluralize } from '@/app/lib/transformers';

interface StatisticsProps {
  stats?: ReportStats;
}

const ReportStatistics: FC<StatisticsProps> = ({ stats }) => {
  if (!stats || Object.keys(stats).length === 0) {
    return <div>No statistics available</div>;
  }

  return (
    <div className="min-w-[400px] min-h-max">
      <h2 className="text-center">
        Total: {stats.total} {pluralize(stats.total, 'test', 'tests')}
      </h2>
      <StatChart stats={stats} />
    </div>
  );
};

export default ReportStatistics;

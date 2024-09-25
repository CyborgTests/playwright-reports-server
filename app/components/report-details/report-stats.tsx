'use client';

import React from 'react';

import { StatChart } from '../stat-chart';

import { type ReportStats } from '@/app/lib/parser';

interface StatisticsProps {
  stats?: ReportStats;
}

const ReportStatistics: React.FC<StatisticsProps> = ({ stats }) => {
  if (!stats || Object.keys(stats).length === 0) {
    return <div>No statistics available</div>;
  }

  return (
    <div className="min-w-[400px] min-h-max">
      <h2 className="text-center">Total: {stats.total} tests</h2>
      <StatChart stats={stats} />
    </div>
  );
};

export default ReportStatistics;

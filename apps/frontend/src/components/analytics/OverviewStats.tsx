'use client';

import type { OverviewStats } from '@playwright-reports/shared';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { parseMilliseconds } from '@/lib/time';

interface OverviewStatsProps {
  stats: OverviewStats;
  totalTests?: number;
  flakyCount?: number;
  totalRuns?: number;
}

export function OverviewStatsCard({ stats, totalTests, flakyCount, totalRuns }: Readonly<OverviewStatsProps>) {
  if (!stats || totalTests === undefined) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {Array.from({ length: 5 }).map((_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: that is just a placeholder for 5 elements
          <Card key={index} className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Loading...
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-gray-300 dark:text-gray-600">--</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">No data</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const isPositive = (trend: 'up' | 'down' | 'stable', higherIsBetter: boolean) =>
    (trend === 'up' && higherIsBetter) || (trend === 'down' && !higherIsBetter);

  const getTrendIcon = (trend: 'up' | 'down' | 'stable', higherIsBetter: boolean) => {
    if (trend === 'stable') return <Minus className="h-4 w-4 text-gray-500" />;
    const colorClass = isPositive(trend, higherIsBetter) ? 'text-green-500' : 'text-red-500';
    const Icon = trend === 'up' ? TrendingUp : TrendingDown;
    return <Icon className={`h-4 w-4 ${colorClass}`} />;
  };

  const getTrendColor = (trend: 'up' | 'down' | 'stable', higherIsBetter: boolean) => {
    if (trend === 'stable') return 'text-gray-600 dark:text-gray-400';
    return isPositive(trend, higherIsBetter)
      ? 'text-green-600 dark:text-green-400'
      : 'text-red-600 dark:text-red-400';
  };

  const {
    passRate = 0,
    averageTestDuration = 0,
    averageTestRunDuration = 0,
    passRateTrend = 'stable' as const,
    flakyTestsTrend = 'stable' as const,
  } = stats;

  const statsCards = [
    {
      title: 'Total Tests',
      value: totalTests.toLocaleString(),
      subtitle: `Across ${totalRuns ?? 0} ${(totalRuns ?? 0) === 1 ? 'run' : 'runs'}`,
    },
    {
      title: 'Pass Rate',
      value: `${passRate.toFixed(2)}%`,
      subtitle: '7-day/30-day comparison',
      icon: getTrendIcon(passRateTrend, true),
      iconColor: getTrendColor(passRateTrend, true),
    },
    {
      title: 'Flaky Tests',
      value: (flakyCount ?? 0).toString(),
      subtitle: 'Failing intermittently',
      icon: getTrendIcon(flakyTestsTrend, false),
      iconColor: getTrendColor(flakyTestsTrend, false),
    },
    {
      title: 'Avg Test Duration',
      value: parseMilliseconds(averageTestDuration),
      subtitle: 'Mean execution time',
    },
    {
      title: 'Average Run Time',
      value: parseMilliseconds(averageTestRunDuration),
      subtitle: 'Average for latest runs',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
      {statsCards.map((card) => (
        <Card key={card.title} className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
              {card.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{card.value}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{card.subtitle}</p>
              </div>
              {card.icon && <div className={card.iconColor}>{card.icon}</div>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

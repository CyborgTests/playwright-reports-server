'use client';

import type { OverviewStats, StatDelta } from '@playwright-reports/shared';
import { formatDuration } from '@playwright-reports/shared';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface OverviewStatsProps {
  stats?: OverviewStats;
  totalTests?: number;
  flakyCount?: number;
  totalRuns?: number;
  onFlakyClick?: () => void;
}

type Direction = 'up' | 'down' | 'stable';

export function OverviewStatsCard({
  stats,
  totalTests,
  flakyCount,
  totalRuns,
  onFlakyClick,
}: Readonly<OverviewStatsProps>) {
  if (!stats || totalTests === undefined) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {Array.from({ length: 5 }).map((_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: that is just a placeholder for 5 elements
          <Card key={index} className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Loading...
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-muted-foreground/40">--</p>
                  <p className="text-xs text-muted-foreground mt-1">No data</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const isGoodDirection = (trend: Direction, higherIsBetter: boolean) =>
    (trend === 'up' && higherIsBetter) || (trend === 'down' && !higherIsBetter);

  const colorFor = (trend: Direction, higherIsBetter: boolean) => {
    if (trend === 'stable') return 'text-muted-foreground';
    return isGoodDirection(trend, higherIsBetter) ? 'text-success' : 'text-danger';
  };

  const formatPercent = (percent: number | null): string => {
    if (percent === null) return 'new';
    if (percent === 0) return '0%';
    const rounded = Math.round(percent * 10) / 10;
    const abs = Math.abs(rounded);
    const sign = rounded > 0 ? '+' : '−';
    return `${sign}${abs}%`;
  };

  const renderTrend = (delta: StatDelta | undefined, higherIsBetter: boolean) => {
    if (!delta) return null;
    const Icon =
      delta.trend === 'stable' ? Minus : delta.trend === 'up' ? TrendingUp : TrendingDown;
    const colorClass = colorFor(delta.trend, higherIsBetter);
    return (
      <span className={`inline-flex items-center gap-1 text-xs font-medium ${colorClass}`}>
        <Icon className="h-3.5 w-3.5" />
        {formatPercent(delta.percent)}
      </span>
    );
  };

  const {
    passRate = 0,
    averageTestDuration = 0,
    averageTestRunDuration = 0,
    passRateTrend = 'stable' as const,
    flakyTestsTrend = 'stable' as const,
    deltas,
  } = stats;

  const runsCount = totalRuns ?? 0;
  type StatCard = {
    title: string;
    value: string;
    subtitle: string;
    delta?: StatDelta;
    higherIsBetter: boolean;
  };

  type StatCardWithAction = StatCard & { onClick?: () => void };

  const statsCards: StatCardWithAction[] = [
    {
      title: 'Total Runs',
      value: runsCount.toLocaleString(),
      subtitle: `With ${totalTests.toLocaleString()} ${totalTests === 1 ? 'test' : 'tests'}`,
      higherIsBetter: true,
    },
    {
      title: 'Pass Rate',
      value: `${passRate.toFixed(2)}%`,
      subtitle: 'vs previous period',
      delta: deltas?.passRate ?? { percent: null, trend: passRateTrend },
      higherIsBetter: true,
    },
    {
      title: 'Flaky Tests',
      value: (flakyCount ?? 0).toString(),
      subtitle: 'Failing intermittently',
      delta: deltas?.flakyTests ?? { percent: null, trend: flakyTestsTrend },
      higherIsBetter: false,
      onClick: onFlakyClick,
    },
    {
      title: 'Avg Per-Test Duration',
      value: formatDuration(averageTestDuration),
      subtitle: 'Mean per-test execution time',
      delta: deltas?.averageTestDuration,
      higherIsBetter: false,
    },
    {
      title: 'Avg Run Duration',
      value: formatDuration(averageTestRunDuration),
      subtitle: 'Mean full-run duration',
      delta: deltas?.averageTestRunDuration,
      higherIsBetter: false,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
      {statsCards.map((card) => (
        <Card
          key={card.title}
          onClick={card.onClick}
          className={`shadow-sm ${card.onClick ? 'cursor-pointer hover:bg-accent/40 transition-colors' : ''}`}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {card.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-2xl font-bold truncate">{card.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{card.subtitle}</p>
              </div>
              <div className="shrink-0">{renderTrend(card.delta, card.higherIsBetter)}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

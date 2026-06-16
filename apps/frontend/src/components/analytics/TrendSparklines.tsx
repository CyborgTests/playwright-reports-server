'use client';

import type { TrendMetrics } from '@playwright-reports/shared';
import { memo } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface TrendSparklinesProps {
  metrics?: TrendMetrics;
  isLoading?: boolean;
  onSlowClick?: () => void;
  onFlakyClick?: () => void;
}

const durationColor = 'hsl(217, 91%, 60%)'; // blue
const flakyColor = 'hsl(38, 92%, 50%)'; // orange
const slowColor = 'hsl(0, 84%, 60%)'; // red

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  if (hours > 0)
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; dataKey: string }>;
  label?: string;
}) {
  if (active && payload?.length) {
    return (
      <div className="bg-popover text-popover-foreground p-2 rounded shadow-lg border text-xs">
        <p className="font-medium">{new Date(label ?? '').toLocaleDateString()}</p>
        <p>
          {payload[0].name}:{' '}
          {payload[0].dataKey === 'duration' ? formatDuration(payload[0].value) : payload[0].value}
        </p>
      </div>
    );
  }
  return null;
}

function SparklineCard({
  title,
  subtitle,
  children,
  onClick,
}: Readonly<{
  title: string;
  subtitle: string;
  children: React.ReactNode;
  onClick?: () => void;
}>) {
  return (
    <Card
      onClick={onClick}
      className={onClick ? 'cursor-pointer hover:bg-accent/40 transition-colors' : undefined}
    >
      <CardContent className="p-4 pt-4">
        <h4 className="text-sm font-medium mb-1">{title}</h4>
        <p className="text-xs text-muted-foreground mb-4">{subtitle}</p>
        {children}
      </CardContent>
    </Card>
  );
}

function TrendSparklinesImpl({
  metrics,
  isLoading,
  onSlowClick,
  onFlakyClick,
}: Readonly<TrendSparklinesProps>) {
  if (isLoading || !metrics) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <SparklineCard title="Duration Trend" subtitle="Total run duration over time">
          <Skeleton className="h-20 w-full" />
        </SparklineCard>
        <SparklineCard title="Flaky Count Trend" subtitle="Number of intermittently failing tests">
          <Skeleton className="h-20 w-full" />
        </SparklineCard>
        <SparklineCard title="Slow Count Trend" subtitle="Tests slower than 95th percentile">
          <Skeleton className="h-20 w-full" />
        </SparklineCard>
      </div>
    );
  }

  const { durationTrend = [], flakyCountTrend = [], slowCountTrend = [] } = metrics;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
      <SparklineCard title="Duration Trend" subtitle="Total run duration over time">
        <div className="h-20">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={durationTrend.slice(-30).reverse()}>
              <XAxis dataKey="date" hide tick={{ fontSize: 10 }} />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="duration"
                stroke={durationColor}
                fill={durationColor}
                fillOpacity={0.3}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </SparklineCard>

      <SparklineCard
        title="Flaky Count Trend"
        subtitle={'Number of intermittently failing tests'}
        onClick={onFlakyClick}
      >
        <div className="h-20">
          {flakyCountTrend.reduce((sum, p) => sum + (p.count ?? 0), 0) === 0 ? (
            <div className="flex h-full items-center justify-center text-success text-sm font-medium">
              No new flaky tests 🎉
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={flakyCountTrend.slice(-30).reverse()}>
                <XAxis dataKey="date" hide tick={{ fontSize: 10 }} />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke={flakyColor}
                  fill={flakyColor}
                  fillOpacity={0.3}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </SparklineCard>

      <SparklineCard
        title="Slow Count Trend"
        subtitle={
          onSlowClick ? 'Click to sort tests by slowest first' : 'Tests slower than 95th percentile'
        }
        onClick={onSlowClick}
      >
        <div className="h-20">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={slowCountTrend.slice(-30).reverse()}>
              <XAxis dataKey="date" hide tick={{ fontSize: 10 }} />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="count"
                stroke={slowColor}
                fill={slowColor}
                fillOpacity={0.3}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </SparklineCard>
    </div>
  );
}

export const TrendSparklines = memo(TrendSparklinesImpl);

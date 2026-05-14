'use client';

import type { TrendMetrics } from '@playwright-reports/shared';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';

interface TrendSparklinesProps {
  metrics: TrendMetrics;
  isLoading?: boolean;
}

const durationColor = 'hsl(217, 91%, 60%)'; // blue
const flakyColor = 'hsl(38, 92%, 50%)'; // orange
const slowColor = 'hsl(0, 84%, 60%)'; // red

function SparklineSkeleton({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
      <h4 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">{title}</h4>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{subtitle}</p>
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

export function TrendSparklines({ metrics, isLoading }: Readonly<TrendSparklinesProps>) {
  if (isLoading || !metrics) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <SparklineSkeleton title="Duration Trend" subtitle="Total run duration over time" />
        <SparklineSkeleton
          title="Flaky Count Trend"
          subtitle="Number of intermittently failing tests"
        />
        <SparklineSkeleton title="Slow Count Trend" subtitle="Tests slower than 95th percentile" />
      </div>
    );
  }

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    const totalSeconds = Math.floor(ms / 1000);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60) % 60;
    const hours = Math.floor(totalSeconds / 3600);

    if (hours > 0)
      return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
    return `${seconds}s`;
  };

  const { durationTrend = [], flakyCountTrend = [], slowCountTrend = [] } = metrics;

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ name: string; value: number; dataKey: string }>;
    label?: string;
  }) => {
    if (active && payload?.length) {
      return (
        <div className="bg-white dark:bg-gray-800 p-2 rounded shadow-lg border text-xs">
          <p className="font-medium">{new Date(label ?? '').toLocaleDateString()}</p>
          <p>
            {payload[0].name}:{' '}
            {payload[0].dataKey === 'duration'
              ? formatDuration(payload[0].value)
              : payload[0].value}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
        <h4 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">
          Duration Trend
        </h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Total run duration over time
        </p>
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
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
        <h4 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">
          Flaky Count Trend
        </h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Number of intermittently failing tests
        </p>
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
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm">
        <h4 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">
          Slow Count Trend
        </h4>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Tests slower than 95th percentile
        </p>
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
      </div>
    </div>
  );
}

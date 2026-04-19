'use client';

import type { RunHealthMetric } from '@playwright-reports/shared';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';

interface HealthGridProps {
  metrics: RunHealthMetric[];
  isLoading?: boolean;
}

const chartColors = {
  passed: 'hsl(142, 76%, 36%)', // green
  failed: 'hsl(0, 84%, 60%)', // red
  flaky: 'hsl(38, 92%, 50%)', // yellow/orange
};

export function HealthGrid({ metrics, isLoading }: Readonly<HealthGridProps>) {
  const chartData = metrics.map((metric) => ({
    name: new Date(metric.timestamp).toLocaleDateString(),
    runId: metric.runId,
    total: metric.totalTests,
    passed: metric.passed,
    failed: metric.failed,
    flaky: metric.flaky,
    duration: metric.duration,
  }));

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: Array<{
      payload: {
        name: string;
        runId: string;
        passed: number;
        failed: number;
        flaky: number;
        total: number;
      };
    }>;
  }) => {
    if (active && payload?.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-lg border">
          <p className="font-medium">{data.name}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Run ID: {data.runId}</p>
          <div className="mt-2 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-green-600">Passed:</span>
              <span>{data.passed}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-red-600">Failed:</span>
              <span>{data.failed}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-yellow-600">Flaky:</span>
              <span>{data.flaky}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Total:</span>
              <span>{data.total}</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
      <h3 className="text-lg font-semibold mb-4">Test Health Grid</h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        Stacked bar chart showing pass/fail breakdown across the most recent 20 runs
      </p>

      {isLoading ? (
        <Skeleton className="h-[300px] w-full" />
      ) : metrics.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-gray-500">
          No health data available
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={chartData.reverse()}
            onClick={(e) => {
              const reportId = e.activePayload?.[0]?.payload?.runId;
              window.open(`/report/${reportId}`, '_blank');
            }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="passed" stackId="a" fill={chartColors.passed} />
            <Bar dataKey="flaky" stackId="a" fill={chartColors.flaky} />
            <Bar dataKey="failed" stackId="a" fill={chartColors.failed} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

'use client';

import type { RunHealthMetric } from '@playwright-reports/shared';
import { useCallback, useLayoutEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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

const BAR_PX = 36;
const CHART_HEIGHT = 300;

const formatReportHeading = (
  displayNumber: number | undefined,
  title: string | undefined,
  date: string
): string => {
  const parts: string[] = [];
  if (typeof displayNumber === 'number') parts.push(`#${displayNumber}`);
  if (title) parts.push(parts.length ? `— ${title}` : title);
  return parts.length ? `${parts.join(' ')} (${date})` : date;
};

export function HealthGrid({ metrics, isLoading }: Readonly<HealthGridProps>) {
  const chartData = metrics.map((metric) => {
    const date = new Date(metric.timestamp).toLocaleDateString();
    return {
      name: date,
      heading: formatReportHeading(metric.displayNumber, metric.title, date),
      runId: metric.runId,
      total: metric.totalTests,
      passed: metric.passed,
      failed: metric.failed,
      flaky: metric.flaky,
      duration: metric.duration,
    };
  });

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: Array<{
      payload: {
        name: string;
        heading: string;
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
        <div className="bg-popover text-popover-foreground p-3 rounded-lg shadow-lg border">
          <p className="font-medium">{data.heading}</p>
          <p className="text-sm text-muted-foreground">Run ID: {data.runId}</p>
          <div className="mt-2 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-success">Passed:</span>
              <span>{data.passed}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-danger">Failed:</span>
              <span>{data.failed}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-warning">Flaky:</span>
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

  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const scrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    setScrollContainer(node);
    if (node) setContainerWidth(node.clientWidth);
  }, []);

  useLayoutEffect(() => {
    if (!scrollContainer || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      if (next > 0) setContainerWidth(next);
    });
    observer.observe(scrollContainer);
    return () => observer.disconnect();
  }, [scrollContainer]);

  // Stretch chart to fill the container when there are few runs; grow beyond it
  // (and let the container scroll horizontally) when there are many.
  const chartWidth = Math.max(containerWidth, chartData.length * BAR_PX);

  useLayoutEffect(() => {
    if (!scrollContainer) return;
    scrollContainer.scrollLeft = scrollContainer.scrollWidth;
  }, [scrollContainer, chartWidth, isLoading]);

  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold">Test Health Grid</h3>
        <p className="text-sm text-muted-foreground">
          Stacked bar chart showing pass/fail breakdown across {metrics.length}{' '}
          {metrics.length === 1 ? 'run' : 'runs'} in the selected period
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : metrics.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            No health data available
          </div>
        ) : (
          <div ref={scrollContainerRef} className="overflow-x-auto">
            <BarChart
              width={chartWidth}
              height={CHART_HEIGHT}
              data={chartData.reverse()}
              onClick={(e) => {
                const reportId = e.activePayload?.[0]?.payload?.runId;
                if (reportId) window.open(`/report/${reportId}`, '_blank');
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}

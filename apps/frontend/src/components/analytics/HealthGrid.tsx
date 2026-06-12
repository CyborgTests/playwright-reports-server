'use client';

import type { RunHealthMetric } from '@playwright-reports/shared';
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

function HealthGridImpl({ metrics, isLoading }: Readonly<HealthGridProps>) {
  const chartData = useMemo(
    () =>
      metrics
        .map((metric) => {
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
            newRegressions: metric.newRegressions ?? 0,
            resolvedRegressions: metric.resolvedRegressions ?? 0,
          };
        })
        .reverse(),
    [metrics]
  );

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
        newRegressions: number;
        resolvedRegressions: number;
      };
    }>;
  }) => {
    if (active && payload?.length) {
      const data = payload[0].payload;
      const hasRegressionInfo = data.newRegressions > 0 || data.resolvedRegressions > 0;
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
            {hasRegressionInfo && (
              <div className="border-t border-border/40 pt-1 mt-1 space-y-0.5">
                {data.newRegressions > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-danger">↓ New regressions:</span>
                    <span className="text-danger font-medium">{data.newRegressions}</span>
                  </div>
                )}
                {data.resolvedRegressions > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-success">↑ Resolved here:</span>
                    <span className="text-success font-medium">{data.resolvedRegressions}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  interface BarShapeProps {
    x?: number;
    y?: number;
    width?: number;
    payload?: { newRegressions?: number; resolvedRegressions?: number };
    fill?: string;
  }
  const RegressionMarkBar = (props: BarShapeProps) => {
    const { x = 0, y = 0, width = 0, fill = chartColors.failed, payload } = props;
    const height = (props as { height?: number }).height ?? 0;
    const opened = payload?.newRegressions ?? 0;
    const closed = payload?.resolvedRegressions ?? 0;
    const hasMark = opened > 0 || closed > 0;
    // cap at "99+" so an unusually-broken run can't blow out the chip width
    // and run into the next bar.
    const fmt = (n: number) => (n > 99 ? '99+' : String(n));
    const segments: Array<{ text: string; bg: string; fg: string }> = [];
    if (opened > 0) {
      segments.push({ text: `↓${fmt(opened)}`, bg: 'hsl(0, 84%, 60%)', fg: 'white' });
    }
    if (closed > 0) {
      segments.push({ text: `↑${fmt(closed)}`, bg: 'hsl(142, 76%, 36%)', fg: 'white' });
    }
    const CHIP_H = 14;
    const CHIP_PADDING = 6;
    const CHIP_GAP = 2;
    const CHIP_FONT = 10;
    const charWidth = (ch: string) => (ch === '↑' || ch === '↓' ? 9 : 6.5);
    const chipWidths = segments.map((s) => {
      const inner = [...s.text].reduce((sum, c) => sum + charWidth(c), 0);
      return Math.max(20, Math.ceil(inner) + CHIP_PADDING * 2);
    });
    const totalWidth =
      chipWidths.reduce((a, b) => a + b, 0) + Math.max(0, segments.length - 1) * CHIP_GAP;
    const startX = x + (width - totalWidth) / 2;
    const chipY = y - CHIP_H - 2;
    let cursor = startX;
    return (
      <g>
        <rect x={x} y={y} width={width} height={height} fill={fill} />
        {hasMark &&
          segments.map((s, i) => {
            const w = chipWidths[i];
            const cx = cursor;
            cursor += w + CHIP_GAP;
            return (
              <g key={s.text}>
                <rect x={cx} y={chipY} width={w} height={CHIP_H} rx={4} ry={4} fill={s.bg} />
                <text
                  x={cx + w / 2}
                  y={chipY + CHIP_H / 2 + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={CHIP_FONT}
                  fontWeight={600}
                  fill={s.fg}
                >
                  {s.text}
                </text>
              </g>
            );
          })}
      </g>
    );
  };

  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const hasAutoScrolledRef = useRef(false);

  const scrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    setScrollContainer(node);
    if (node) setContainerWidth(node.clientWidth);
  }, []);

  useLayoutEffect(() => {
    if (!scrollContainer || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      if (next > 0) setContainerWidth((prev) => (prev === next ? prev : next));
    });
    observer.observe(scrollContainer);
    return () => observer.disconnect();
  }, [scrollContainer]);

  // Stretch chart to fill the container when there are few runs; grow beyond it
  // (and let the container scroll horizontally) when there are many.
  const chartWidth = Math.max(containerWidth, chartData.length * BAR_PX);

  useLayoutEffect(() => {
    if (!scrollContainer || hasAutoScrolledRef.current) return;
    if (isLoading || chartData.length === 0) return;
    scrollContainer.scrollLeft = scrollContainer.scrollWidth;
    hasAutoScrolledRef.current = true;
  }, [scrollContainer, chartData.length, isLoading]);

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
              data={chartData}
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
              <Bar
                dataKey="failed"
                stackId="a"
                fill={chartColors.failed}
                shape={RegressionMarkBar}
              />
            </BarChart>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const HealthGrid = memo(HealthGridImpl);

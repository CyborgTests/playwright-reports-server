import type { RunHealthMetric } from '@playwright-reports/shared';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
const CHART_MARGIN_TOP = 40;
const XAXIS_HEIGHT = 80;
const PLOT_TOP = CHART_MARGIN_TOP;
const PLOT_BOTTOM = CHART_HEIGHT - XAXIS_HEIGHT;
const STICKY_AXIS_W = 48;
const WINDOW_OVERSCAN = 8;

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

function niceAxisTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(Math.round(v));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function CustomTooltip({
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
}) {
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
}

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: { newRegressions?: number; resolvedRegressions?: number };
  fill?: string;
}

function RegressionMarkBar(props: BarShapeProps) {
  const { x = 0, y = 0, width = 0, height = 0, fill = chartColors.failed, payload } = props;
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
  const CHIP_ROW_GAP = 2;
  const CHIP_FONT = 10;
  const charWidth = (ch: string) => (ch === '↑' || ch === '↓' ? 9 : 6.5);
  const chipWidths = segments.map((s) => {
    const inner = [...s.text].reduce((sum, c) => sum + charWidth(c), 0);
    return Math.max(20, Math.ceil(inner) + CHIP_PADDING * 2);
  });
  const stackHeight = segments.length * CHIP_H + Math.max(0, segments.length - 1) * CHIP_ROW_GAP;
  const baseChipY = y - stackHeight - 2;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} />
      {hasMark &&
        segments.map((s, i) => {
          const w = chipWidths[i];
          const cx = x + (width - w) / 2;
          const cy = baseChipY + i * (CHIP_H + CHIP_ROW_GAP);
          return (
            <g key={s.text}>
              <rect x={cx} y={cy} width={w} height={CHIP_H} rx={4} ry={4} fill={s.bg} />
              <text
                x={cx + w / 2}
                y={cy + CHIP_H / 2 + 1}
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
}

type ChartDatum = {
  name: string;
  heading: string;
  runId: string;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  duration: number;
  newRegressions: number;
  resolvedRegressions: number;
};

const BAR_ANIMATION_MS = 500;

function chartChildren(animate: boolean) {
  return (
    <>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis
        dataKey="name"
        tick={{ fontSize: 12 }}
        angle={-45}
        textAnchor="end"
        height={XAXIS_HEIGHT}
      />
      <Tooltip
        content={<CustomTooltip />}
        wrapperStyle={{ pointerEvents: 'auto' }}
        isAnimationActive={false}
      />
      <Bar
        dataKey="passed"
        stackId="a"
        fill={chartColors.passed}
        isAnimationActive={animate}
        animationDuration={BAR_ANIMATION_MS}
      />
      <Bar
        dataKey="flaky"
        stackId="a"
        fill={chartColors.flaky}
        isAnimationActive={animate}
        animationDuration={BAR_ANIMATION_MS}
      />
      <Bar
        dataKey="failed"
        stackId="a"
        fill={chartColors.failed}
        shape={RegressionMarkBar}
        isAnimationActive={animate}
        animationDuration={BAR_ANIMATION_MS}
      />
    </>
  );
}

function StickyYAxis({ axisMax }: { axisMax: number }) {
  const ticks = niceAxisTicks(axisMax);
  const top = axisMax > 0 ? ticks[ticks.length - 1] : 1;
  const yFor = (v: number) => PLOT_BOTTOM - (v / top) * (PLOT_BOTTOM - PLOT_TOP);
  return (
    <svg
      width={STICKY_AXIS_W}
      height={CHART_HEIGHT}
      className="shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <line
        x1={STICKY_AXIS_W - 1}
        y1={PLOT_TOP}
        x2={STICKY_AXIS_W - 1}
        y2={PLOT_BOTTOM}
        stroke="currentColor"
        strokeOpacity={0.3}
      />
      {ticks.map((v) => {
        const y = yFor(v);
        return (
          <g key={v}>
            <line
              x1={STICKY_AXIS_W - 5}
              y1={y}
              x2={STICKY_AXIS_W - 1}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.3}
            />
            <text
              x={STICKY_AXIS_W - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={12}
              fill="currentColor"
            >
              {v}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function HealthGridImpl({ metrics, isLoading }: Readonly<HealthGridProps>) {
  const chartData = useMemo<ChartDatum[]>(
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

  const axisMax = useMemo(() => {
    let m = 0;
    for (const d of chartData) m = Math.max(m, d.passed + d.flaky + d.failed);
    const ticks = niceAxisTicks(m);
    return ticks[ticks.length - 1] || 1;
  }, [chartData]);

  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const rafRef = useRef(0);

  // Animate bars only briefly after the dataset changes;
  const [animateBars, setAnimateBars] = useState(true);
  useEffect(() => {
    if (chartData.length === 0) return;
    setAnimateBars(true);
    const t = setTimeout(() => setAnimateBars(false), BAR_ANIMATION_MS + 200);
    return () => clearTimeout(t);
  }, [chartData]);

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

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const left = e.currentTarget.scrollLeft;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setScrollLeft(left);
    });
  }, []);

  const totalWidth = chartData.length * BAR_PX;
  const overflow = containerWidth > 0 && totalWidth > containerWidth;

  const visibleCount = Math.ceil(containerWidth / BAR_PX) + 2 * WINDOW_OVERSCAN;
  const maxStart = Math.max(0, chartData.length - visibleCount);
  const start = overflow
    ? Math.min(Math.max(0, Math.floor(scrollLeft / BAR_PX) - WINDOW_OVERSCAN), maxStart)
    : 0;
  const end = overflow ? Math.min(chartData.length, start + visibleCount) : chartData.length;
  const windowData = overflow ? chartData.slice(start, end) : chartData;
  const windowWidth = overflow ? windowData.length * BAR_PX : Math.max(containerWidth, totalWidth);
  const offsetX = overflow ? start * BAR_PX : 0;

  // Auto-scroll to the most recent (rightmost) run whenever the dataset changes.
  useLayoutEffect(() => {
    if (!scrollContainer || isLoading || chartData.length === 0) return;
    scrollContainer.scrollLeft = scrollContainer.scrollWidth;
    setScrollLeft(scrollContainer.scrollLeft);
  }, [scrollContainer, chartData, isLoading]);

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
          <div className="flex">
            {overflow && <StickyYAxis axisMax={axisMax} />}
            <div ref={scrollContainerRef} onScroll={onScroll} className="overflow-x-auto flex-1">
              {overflow ? (
                <div style={{ width: totalWidth, height: CHART_HEIGHT, position: 'relative' }}>
                  <div style={{ position: 'absolute', left: offsetX, top: 0 }}>
                    <BarChart
                      width={windowWidth}
                      height={CHART_HEIGHT}
                      data={windowData}
                      margin={{ top: CHART_MARGIN_TOP, right: 0, bottom: 0, left: 0 }}
                      onClick={(ev) => {
                        const reportId = ev.activePayload?.[0]?.payload?.runId;
                        if (reportId) window.open(`/report/${reportId}`, '_blank');
                      }}
                    >
                      <YAxis hide domain={[0, axisMax]} />
                      {chartChildren(animateBars)}
                    </BarChart>
                  </div>
                </div>
              ) : (
                <BarChart
                  width={windowWidth}
                  height={CHART_HEIGHT}
                  data={windowData}
                  margin={{ top: CHART_MARGIN_TOP, right: 0, bottom: 0, left: 0 }}
                  onClick={(ev) => {
                    const reportId = ev.activePayload?.[0]?.payload?.runId;
                    if (reportId) window.open(`/report/${reportId}`, '_blank');
                  }}
                >
                  <YAxis domain={[0, axisMax]} />
                  {chartChildren(animateBars)}
                </BarChart>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const HealthGrid = memo(HealthGridImpl);

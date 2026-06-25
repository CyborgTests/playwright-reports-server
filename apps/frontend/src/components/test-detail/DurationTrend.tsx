import type { TestRun } from '@playwright-reports/shared';
import { formatDuration } from '@playwright-reports/shared';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import FormattedDate from '@/components/date-format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { formatDate } from '@/lib/date';
import { dotColor, outcomeBadge, servedReportUrl } from './test-detail-widgets';

const POINT_PX = 36;
const PREVIOUS_LOAD_THRESHOLD_PX = 400;
const CHART_HEIGHT = 280;
const CHART_MARGIN_TOP = 16;
const XAXIS_HEIGHT = 48;
const PLOT_TOP = CHART_MARGIN_TOP;
const PLOT_BOTTOM = CHART_HEIGHT - XAXIS_HEIGHT;
const STICKY_AXIS_W = 56;

interface DurationPoint {
  createdAt: string;
  duration: number;
  outcome: string;
  reportId: string;
  reportDisplayNumber?: number;
  reportTitle?: string;
  failureCategory?: string;
  isOutlier: boolean;
}

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

function DurationTooltip({
  active,
  payload,
}: Readonly<{ active?: boolean; payload?: Array<{ payload: DurationPoint }> }>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const reportLabel = p.reportDisplayNumber ? `#${p.reportDisplayNumber}` : p.reportId.slice(0, 8);
  return (
    <div className="rounded-md border bg-popover text-popover-foreground shadow-md p-2.5 text-xs space-y-1 max-w-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold">{reportLabel}</span>
        {outcomeBadge(p.outcome)}
        {p.isOutlier && <Badge variant="outline">Outlier</Badge>}
      </div>
      {p.reportTitle && <div className="text-muted-foreground truncate">{p.reportTitle}</div>}
      <div className="text-muted-foreground">
        <FormattedDate date={p.createdAt} />
      </div>
      <div>
        <span className="text-muted-foreground">Duration: </span>
        <span className="font-medium">{formatDuration(p.duration)}</span>
      </div>
      {p.failureCategory && (
        <div>
          <span className="text-muted-foreground">Failure: </span>
          <span className="font-medium">{p.failureCategory}</span>
        </div>
      )}
    </div>
  );
}

interface OutcomeDotProps {
  cx?: number;
  cy?: number;
  payload?: DurationPoint;
  radius?: number;
}

function OutcomeDot({ cx, cy, payload, radius = 4.5 }: OutcomeDotProps) {
  if (typeof cx !== 'number' || typeof cy !== 'number' || !payload) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={radius}
      fill={dotColor(payload.outcome)}
      stroke={payload.isOutlier ? 'hsl(var(--danger))' : 'transparent'}
      strokeWidth={2}
    />
  );
}

function StickyYAxis({ axisMax }: Readonly<{ axisMax: number }>) {
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
              fontSize={11}
              fill="currentColor"
            >
              {formatDuration(v)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function DurationTrend({
  runs,
  mean,
  p95,
  stdDev,
  testId,
  totalRuns,
  onLoadPrevious,
  hasMorePrevious = false,
  isLoadingPrevious = false,
}: Readonly<{
  runs: TestRun[];
  mean?: number;
  p95?: number;
  stdDev?: number;
  testId: string;
  totalRuns?: number;
  onLoadPrevious?: () => void;
  hasMorePrevious?: boolean;
  isLoadingPrevious?: boolean;
}>) {
  const data = useMemo<DurationPoint[]>(
    () =>
      [...runs]
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .filter((r) => typeof r.duration === 'number')
        .map((r) => {
          const duration = r.duration ?? 0;
          const isOutlier =
            typeof mean === 'number' &&
            typeof stdDev === 'number' &&
            stdDev > 0 &&
            Math.abs(duration - mean) > 2 * stdDev;
          return {
            createdAt: r.createdAt,
            duration,
            outcome: r.outcome,
            reportId: r.reportId,
            reportDisplayNumber: r.reportDisplayNumber,
            reportTitle: r.reportTitle,
            failureCategory: r.failureCategory,
            isOutlier,
          };
        }),
    [runs, mean, stdDev]
  );

  const axisMax = useMemo(() => {
    let m = typeof p95 === 'number' ? p95 : 0;
    for (const d of data) m = Math.max(m, d.duration);
    const ticks = niceAxisTicks(m);
    return ticks[ticks.length - 1] || 1;
  }, [data, p95]);

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
      if (next > 0) setContainerWidth((prev) => (prev === next ? prev : next));
    });
    observer.observe(scrollContainer);
    return () => observer.disconnect();
  }, [scrollContainer]);

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (
        e.currentTarget.scrollLeft < PREVIOUS_LOAD_THRESHOLD_PX &&
        hasMorePrevious &&
        !isLoadingPrevious
      ) {
        onLoadPrevious?.();
      }
    },
    [hasMorePrevious, isLoadingPrevious, onLoadPrevious]
  );

  const scrollSyncRef = useRef<{ newestId?: string; length: number }>({ length: 0 });
  useLayoutEffect(() => {
    if (!scrollContainer || data.length === 0) return;
    const newestId = data[data.length - 1]?.reportId;
    const prev = scrollSyncRef.current;
    if (prev.newestId !== newestId) {
      scrollContainer.scrollLeft = scrollContainer.scrollWidth;
    } else if (data.length > prev.length) {
      scrollContainer.scrollLeft += (data.length - prev.length) * POINT_PX;
    }
    scrollSyncRef.current = { newestId, length: data.length };
  }, [scrollContainer, data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: data/containerWidth are re-check triggers
  useLayoutEffect(() => {
    if (!scrollContainer || !hasMorePrevious || isLoadingPrevious) return;
    if (scrollContainer.scrollWidth <= scrollContainer.clientWidth + 4) {
      onLoadPrevious?.();
    }
  }, [scrollContainer, data, containerWidth, hasMorePrevious, isLoadingPrevious, onLoadPrevious]);

  if (data.length < 2) {
    return (
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Duration Trend</h3>
          <p className="text-sm text-muted-foreground">
            Need at least 2 timed runs to plot a trend
          </p>
        </CardHeader>
      </Card>
    );
  }

  const handleChartClick = (state: { activePayload?: Array<{ payload?: DurationPoint }> }) => {
    const point = state?.activePayload?.[0]?.payload;
    if (!point?.reportId) return;
    window.open(servedReportUrl(point.reportId, testId), '_blank', 'noopener,noreferrer');
  };

  const plotWidth = Math.max(containerWidth, data.length * POINT_PX);
  const loadedLabel =
    totalRuns && totalRuns > data.length ? `${data.length} of ${totalRuns}` : `${data.length}`;

  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold">Duration Trend</h3>
        <p className="text-sm text-muted-foreground">
          Per-run duration across {loadedLabel} timed runs · scroll left for previous runs · click a
          point to open that run's report
          {isLoadingPrevious ? ' · loading previous…' : ''}
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex">
          <StickyYAxis axisMax={axisMax} />
          <div ref={scrollContainerRef} onScroll={onScroll} className="overflow-x-auto flex-1">
            <LineChart
              width={plotWidth}
              height={CHART_HEIGHT}
              data={data}
              margin={{ top: CHART_MARGIN_TOP, right: 16, bottom: 0, left: 0 }}
              onClick={handleChartClick}
              style={{ cursor: 'pointer' }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="createdAt"
                height={XAXIS_HEIGHT}
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => formatDate(v, 'date')}
              />
              <YAxis hide domain={[0, axisMax]} />
              <RechartsTooltip content={<DurationTooltip />} />
              {typeof mean === 'number' && (
                <ReferenceLine y={mean} stroke="hsl(217, 91%, 60%)" strokeDasharray="4 4" />
              )}
              {typeof p95 === 'number' && (
                <ReferenceLine y={p95} stroke="hsl(0, 84%, 60%)" strokeDasharray="4 4" />
              )}
              <Line
                type="monotone"
                dataKey="duration"
                stroke="hsl(217, 91%, 60%)"
                strokeWidth={2}
                isAnimationActive={false}
                dot={(props: unknown) => {
                  const { key, ...p } = props as OutcomeDotProps & { index?: number; key?: string };
                  return <OutcomeDot key={key ?? `dot-${p.index}`} {...p} />;
                }}
                activeDot={(props: unknown) => {
                  const { key, ...p } = props as OutcomeDotProps & { index?: number; key?: string };
                  return <OutcomeDot key={key ?? `active-${p.index}`} {...p} radius={6} />;
                }}
              />
            </LineChart>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: dotColor('passed') }}
              aria-hidden
            />
            Passed
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: dotColor('failed') }}
              aria-hidden
            />
            Failed
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: dotColor('flaky') }}
              aria-hidden
            />
            Flaky
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: dotColor('skipped') }}
              aria-hidden
            />
            Skipped
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full bg-transparent"
              style={{ boxShadow: 'inset 0 0 0 2px hsl(var(--danger))' }}
              aria-hidden
            />
            Outlier (&gt;2σ from mean)
          </span>
          <span className="flex items-center gap-2">
            <span
              className="inline-block w-6 border-t-2 border-dashed"
              style={{ borderColor: 'hsl(217, 91%, 60%)' }}
              aria-hidden
            />
            Mean {typeof mean === 'number' ? `· ${formatDuration(mean)}` : ''}
          </span>
          <span className="flex items-center gap-2">
            <span
              className="inline-block w-6 border-t-2 border-dashed"
              style={{ borderColor: 'hsl(0, 84%, 60%)' }}
              aria-hidden
            />
            p95 {typeof p95 === 'number' ? `· ${formatDuration(p95)}` : ''}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

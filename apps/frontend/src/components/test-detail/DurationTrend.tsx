import type { TestRun } from '@playwright-reports/shared';
import { formatDuration } from '@playwright-reports/shared';
import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { dotColor, outcomeBadge, servedReportUrl } from './test-detail-widgets';

interface DurationPoint {
  createdAt: string;
  duration: number;
  outcome: string;
  reportId: string;
  reportDisplayNumber?: number;
  reportTitle?: string;
  isOutlier: boolean;
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
      <div className="text-muted-foreground">{new Date(p.createdAt).toLocaleString()}</div>
      <div>
        <span className="text-muted-foreground">Duration: </span>
        <span className="font-medium">{formatDuration(p.duration)}</span>
      </div>
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

export function DurationTrend({
  runs,
  mean,
  p95,
  stdDev,
  testId,
}: Readonly<{
  runs: TestRun[];
  mean?: number;
  p95?: number;
  stdDev?: number;
  testId: string;
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
            isOutlier,
          };
        }),
    [runs, mean, stdDev]
  );

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

  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold">Duration Trend</h3>
        <p className="text-sm text-muted-foreground">
          Per-run duration with mean and p95 reference lines · dot color encodes outcome, red ring
          marks outliers · click a point to open that run's report
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 5, right: 16, bottom: 5, left: 0 }}
              onClick={handleChartClick}
              style={{ cursor: 'pointer' }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="createdAt"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => new Date(v).toLocaleDateString()}
              />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatDuration(v)} />
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
                dot={(props: unknown) => {
                  const p = props as OutcomeDotProps & { index?: number; key?: string };
                  return <OutcomeDot key={p.key ?? `dot-${p.index}`} {...p} />;
                }}
                activeDot={(props: unknown) => {
                  const p = props as OutcomeDotProps & { index?: number; key?: string };
                  return <OutcomeDot key={p.key ?? `active-${p.index}`} {...p} radius={6} />;
                }}
              />
            </LineChart>
          </ResponsiveContainer>
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

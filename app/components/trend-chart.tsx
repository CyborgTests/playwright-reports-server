'use client';
import { Area, AreaChart, XAxis } from 'recharts';
import Link from 'next/link';

import { type ReportHistory } from '@/app/lib/storage';
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/app/components/ui/chart';

const chartConfig = {
  failed: {
    label: 'Failed',
    color: 'hsl(var(--chart-2))',
  },
  flaky: {
    label: 'Flaky',
    color: 'hsl(var(--chart-4))',
  },
  passed: {
    label: 'Passed',
    color: 'hsl(var(--chart-1))',
  },
  skipped: {
    label: 'Skipped',
    color: 'hsl(var(--chart-3))',
  },
} satisfies ChartConfig;

interface WithTotal {
  total: number;
}

interface TrendChartProps {
  reportHistory: ReportHistory[];
}

export function TrendChart({ reportHistory }: Readonly<TrendChartProps>) {
  const getPercentage = (value: number, total: number) => (value / total) * 100;

  const openInNewTab = (url: string) => {
    typeof window !== 'undefined' && window.open(url, '_blank', 'noopener,noreferrer');
  };

  const chartData = reportHistory.map((r) => ({
    date: new Date(r.createdAt).getTime(),
    passed: getPercentage(r.stats.expected, r.stats.total),
    passedCount: r.stats.expected,
    failed: getPercentage(r.stats.unexpected, r.stats.total),
    failedCount: r.stats.unexpected,
    skipped: getPercentage(r.stats.skipped, r.stats.total),
    skippedCount: r.stats.skipped,
    flaky: getPercentage(r.stats.flaky, r.stats.total),
    flakyCount: r.stats.flaky,
    total: r.stats.total,
    reportUrl: r.reportUrl,
  }));

  return (
    <ChartContainer config={chartConfig}>
      {reportHistory.length <= 1 ? (
        <span>Not enough data for trend chart</span>
      ) : (
        <AreaChart
          accessibilityLayer
          data={chartData.reverse()}
          margin={{
            left: 12,
            right: 12,
            top: 12,
          }}
          onClick={(e) => {
            const url = e.activePayload?.at(0)?.payload?.reportUrl;

            url && openInNewTab(url);
          }}
        >
          <XAxis
            axisLine={false}
            dataKey="date"
            tickFormatter={(value: number) => {
              return new Date(value).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              });
            }}
            tickLine={false}
            tickMargin={10}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                hideLabel
                className="w-[250px]"
                formatter={(value, name, item, index) => (
                  <>
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-[--color-bg]"
                      style={
                        {
                          '--color-bg': `var(--color-${name})`,
                        } as React.CSSProperties
                      }
                    />
                    {chartConfig[name as keyof typeof chartConfig]?.label || name}
                    <div className="ml-auto flex items-baseline gap-0.5 font-mono font-medium tabular-nums text-foreground">
                      {
                        item.payload[
                          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                          `${name}Count`
                        ]
                      }{' '}
                      ({Math.round(value as number)}%)
                    </div>
                    {/* Add this after the last item */}
                    {index === 3 && (
                      <>
                        <Link href={'/'} />
                        <div className="mt-1.5 flex basis-full items-center border-t pt-1.5 text-xs font-medium text-foreground">
                          Total
                          <div className="ml-auto flex items-baseline gap-0.5 font-mono font-medium tabular-nums text-foreground">
                            {(item.payload as WithTotal).total}
                            <span className="font-normal text-muted-foreground">tests</span>
                          </div>
                        </div>
                        <div className="mt-1.5 flex basis-full items-center border-t pt-1.5 text-xs font-medium text-foreground">
                          Created At
                          <div className="ml-auto flex items-baseline gap-0.5 font-mono font-medium tabular-nums text-foreground">
                            {new Date(
                              // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
                              item.payload.date,
                            ).toLocaleString()}
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              />
            }
            cursor={true}
          />
          {Object.keys(chartConfig).map((key) => (
            <Area
              key={key}
              dataKey={key}
              fill={`var(--color-${key})`}
              fillOpacity={0.7}
              stackId="single"
              stroke={`var(--color-${key})`}
            />
          ))}
          <ChartLegend content={<ChartLegendContent />} />
        </AreaChart>
      )}
    </ChartContainer>
  );
}

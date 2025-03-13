import { Label, Pie, PieChart } from 'recharts';

import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/app/components/ui/chart';

const chartConfig = {
  count: {
    label: 'Count',
  },
  expected: {
    label: 'Passed',
    color: 'hsl(var(--chart-1))',
  },
  unexpected: {
    label: 'Failed',
    color: 'hsl(var(--chart-2))',
  },
  flaky: {
    label: 'Flaky',
    color: 'hsl(var(--chart-3))',
  },
  skipped: {
    label: 'Skipped',
    color: 'hsl(var(--chart-4))',
  },
} satisfies ChartConfig;

interface StatChartProps {
  stats: {
    total: number;
    expected: number;
    unexpected: number;
    flaky: number;
    skipped: number;
    ok: boolean;
  };
}

export function StatChart({ stats }: Readonly<StatChartProps>) {
  const chartData = [
    {
      count: stats.expected,
      status: 'Passed',
      fill: 'hsl(var(--chart-1))',
    },
    {
      count: stats.unexpected,
      status: 'Failed',
      fill: 'hsl(var(--chart-2))',
    },
    { count: stats.flaky, status: 'Flaky', fill: 'hsl(var(--chart-4))' },
    {
      count: stats.skipped,
      status: 'Skipped',
      fill: 'hsl(var(--chart-3))',
    },
  ];

  return (
    <ChartContainer className="mx-auto aspect-square max-h-[250px]" config={chartConfig}>
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent hideLabel />} cursor={false} />
        <Pie data={chartData} dataKey="count" innerRadius={60} nameKey="status" strokeWidth={5}>
          <Label
            content={({ viewBox }) => {
              if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                return (
                  <text dominantBaseline="middle" textAnchor="middle" x={viewBox.cx} y={viewBox.cy}>
                    <tspan className="fill-foreground text-3xl font-bold" x={viewBox.cx} y={viewBox.cy}>
                      {`${Math.round((stats.expected / (stats.total - stats.skipped)) * 100)}%`}
                    </tspan>
                    <tspan className="fill-foreground" x={viewBox.cx} y={(viewBox.cy ?? 0) + 24}>
                      Passed
                    </tspan>
                  </text>
                );
              }
            }}
          />
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}

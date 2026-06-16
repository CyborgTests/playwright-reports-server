'use client';

import { memo, useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCategoryName } from '@/lib/format';

interface CategoryData {
  category: string;
  count: number;
  percentage: number;
}

interface FailureCategoryChartProps {
  categories?: CategoryData[];
  totalFailures?: number;
  isLoading?: boolean;
  onCategoryClick?: (category: string) => void;
}

const categoryColors: Record<string, string> = {
  // Semantic root-cause labels (LLM-assigned).
  app_bug: 'hsl(0, 84%, 60%)',
  test_bug: 'hsl(38, 92%, 50%)',
  infrastructure: 'hsl(260, 60%, 55%)',
  environment: 'hsl(160, 50%, 45%)',
  slow_path: 'hsl(280, 60%, 55%)',
  // Technical surface labels (heuristic).
  timeout: 'hsl(38, 92%, 50%)',
  snapshot_mismatch: 'hsl(280, 60%, 55%)',
  element_not_found: 'hsl(200, 80%, 50%)',
  element_not_visible: 'hsl(210, 80%, 55%)',
  assertion_error: 'hsl(0, 84%, 60%)',
  network_error: 'hsl(20, 90%, 48%)',
  navigation_error: 'hsl(340, 75%, 55%)',
  api_error: 'hsl(260, 60%, 55%)',
  authentication_error: 'hsl(45, 90%, 50%)',
  javascript_error: 'hsl(180, 60%, 45%)',
  setup_teardown: 'hsl(160, 50%, 45%)',
  browser_crash: 'hsl(0, 70%, 40%)',
  unknown: 'hsl(220, 10%, 60%)',
};

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: CategoryData }>;
}) {
  if (active && payload?.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-popover text-popover-foreground p-3 rounded-lg shadow-lg border">
        <p className="font-medium">{formatCategoryName(data.category)}</p>
        <p className="text-sm text-muted-foreground">
          {data.count} failures ({data.percentage.toFixed(1)}%)
        </p>
      </div>
    );
  }
  return null;
}

function FailureCategoryChartImpl({
  categories,
  totalFailures,
  isLoading,
  onCategoryClick,
}: Readonly<FailureCategoryChartProps>) {
  const chartData = useMemo(
    () => (categories ?? []).filter((c) => c.count > 0).sort((a, b) => b.count - a.count),
    [categories]
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Failure Categories</h3>
            <p className="text-sm text-muted-foreground">
              Breakdown of test failures by category (latest failed reports)
            </p>
          </div>
          {totalFailures !== undefined && (
            <span className="text-sm text-muted-foreground">{totalFailures} total failures</span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[160px] w-full" />
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            No failure data available
          </div>
        ) : chartData.length === 1 ? (
          (() => {
            const only = chartData[0];
            const accent = categoryColors[only.category] ?? categoryColors.unknown;
            return (
              <button
                type="button"
                className={`flex items-center gap-4 rounded-md border bg-muted/30 p-4 text-left w-full${onCategoryClick ? ' cursor-pointer hover:bg-muted/50 transition-colors' : ''}`}
                style={{ borderLeft: `4px solid ${accent}` }}
                onClick={() => onCategoryClick?.(only.category)}
              >
                <div className="text-3xl font-bold tabular-nums">{only.count}</div>
                <div className="text-sm">
                  <div className="font-medium">{formatCategoryName(only.category)}</div>
                  <div className="text-muted-foreground">
                    All {only.count === 1 ? 'failure is' : 'failures are'} in this category
                  </div>
                </div>
              </button>
            );
          })()
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(80, chartData.length * 28 + 40)}>
            <BarChart
              data={chartData}
              layout="vertical"
              barSize={16}
              margin={{ left: 120, top: 8, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" />
              <YAxis
                type="category"
                dataKey="category"
                tick={{ fontSize: 12 }}
                tickFormatter={formatCategoryName}
                width={110}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar
                dataKey="count"
                radius={[0, 4, 4, 0]}
                cursor={onCategoryClick ? 'pointer' : undefined}
                onClick={(data: { payload: CategoryData }) =>
                  onCategoryClick?.(data.payload.category)
                }
              >
                {chartData.map((entry) => (
                  <Cell
                    key={entry.category}
                    fill={categoryColors[entry.category] ?? categoryColors.unknown}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

export const FailureCategoryChart = memo(FailureCategoryChartImpl);

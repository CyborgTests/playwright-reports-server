'use client';

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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
}

const categoryColors: Record<string, string> = {
  timeout: 'hsl(38, 92%, 50%)',
  snapshot_mismatch: 'hsl(280, 60%, 55%)',
  element_not_found: 'hsl(200, 80%, 50%)',
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

export function FailureCategoryChart({ categories, totalFailures, isLoading }: Readonly<FailureCategoryChartProps>) {
  const chartData = (categories ?? [])
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: Array<{ payload: CategoryData }>;
  }) => {
    if (active && payload?.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-lg border">
          <p className="font-medium">{formatCategoryName(data.category)}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {data.count} failures ({data.percentage.toFixed(1)}%)
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Failure Categories</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Breakdown of test failures by category (latest failed reports)
          </p>
        </div>
        {totalFailures !== undefined && (
          <span className="text-sm text-muted-foreground">
            {totalFailures} total failures
          </span>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-[250px] w-full" />
      ) : chartData.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-gray-500">
          No failure data available
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 120 }}>
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
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
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
    </div>
  );
}

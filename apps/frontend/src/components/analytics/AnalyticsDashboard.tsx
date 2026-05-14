'use client';

import type { DateRange } from '@playwright-reports/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useActiveSection } from '../../hooks/useActiveSection';
import { useAnalyticsData } from '../../hooks/useAnalyticsData';
import { useConfig } from '../../hooks/useConfig';
import { useFailureCategoryData } from '../../hooks/useFailureCategoryData';
import useQuery from '../../hooks/useQuery';
import { defaultProjectName } from '../../lib/constants';
import { cn } from '../../lib/utils';
import DateRangeSelect from '../date-range-select';
import ProjectSelect from '../project-select';
import TestManagementWidget from '../test-management/TestManagementWidget';
import { Switch } from '../ui/switch';
import { FailureAnalysisSummary } from './FailureAnalysisSummary';
import { FailureCategoryChart } from './FailureCategoryChart';
import { HealthGrid } from './HealthGrid';
import { OverviewStatsCard } from './OverviewStats';
import { TopFailuresWidget } from './TopFailuresWidget';
import { TrendSparklines } from './TrendSparklines';

const DASHBOARD_SECTIONS: Array<{ id: string; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'trends', label: 'Trends' },
  { id: 'failures', label: 'Failures' },
  { id: 'tests', label: 'Tests' },
];

interface DashboardSectionNavProps {
  failedOnly: boolean;
  onFailedOnlyChange: (value: boolean) => void;
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  project: string;
  onProjectChange: (project: string) => void;
}

export default function AnalyticsDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [project, setProject] = useState(searchParams.get('project') ?? defaultProjectName);
  const [dateRange, setDateRangeState] = useState<DateRange>(() => ({
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
  }));
  const [failedOnly, setFailedOnly] = useState(
    () => searchParams.get('failedOnly') === '1' || searchParams.get('failedOnly') === 'true'
  );

  // Reflect filter state into URL search params so the view is shareable.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (project && project !== defaultProjectName) next.set('project', project);
    else next.delete('project');
    if (dateRange.from) next.set('from', dateRange.from);
    else next.delete('from');
    if (dateRange.to) next.set('to', dateRange.to);
    else next.delete('to');
    if (failedOnly) next.set('failedOnly', '1');
    else next.delete('failedOnly');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [project, dateRange, failedOnly, searchParams, setSearchParams]);

  const {
    data: config,
    error: configError,
    isFetching: isFetchingConfig,
    isPending: isPendingConfig,
  } = useConfig();
  const {
    data: analyticsData,
    error,
    isFetching,
    isPending,
  } = useAnalyticsData(project, dateRange, failedOnly);
  const { data: failureCategoryResponse, isLoading: isLoadingFailures } = useFailureCategoryData(
    project,
    dateRange
  );

  const onProjectChange = useCallback((project: string) => {
    setProject(project);
  }, []);

  const onDateRangeChange = useCallback((range: DateRange) => {
    setDateRangeState(range);
  }, []);

  configError && toast.error(configError.message);
  error && toast.error(error.message);

  const warningThreshold = config?.testManagement?.warningThresholdPercentage ?? 2;

  const summaryUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (project && project !== defaultProjectName) params.append('project', project);
    params.append('warningThreshold', warningThreshold.toString());
    if (dateRange.from) params.append('from', dateRange.from);
    if (dateRange.to) params.append('to', dateRange.to);
    return `/api/tests/summary?${params.toString()}`;
  }, [project, warningThreshold, dateRange.from, dateRange.to]);

  const { data: testsSummary, isLoading: isLoadingSummary } = useQuery<{
    success: boolean;
    total: number;
    flakyCount: number;
  }>(summaryUrl, { dependencies: [project, warningThreshold, dateRange.from, dateRange.to] });

  const isLoading =
    isPending || isFetching || isLoadingSummary || isFetchingConfig || isPendingConfig;

  if (!isLoading && !analyticsData) {
    return (
      <div className="w-[min(100%, 1200px)] mx-auto">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="text-gray-500 dark:text-gray-400 text-lg">
            No analytics data available.
          </div>
          <div className="text-gray-400 dark:text-gray-500 text-sm mt-2">
            Generate some reports first to see analytics.
          </div>
        </div>
      </div>
    );
  }

  const { overviewStats, runHealthMetrics = [], trendMetrics } = analyticsData ?? {};

  return (
    <div className="w-[min(100%, 1200px)] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Analytics Dashboard</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Comprehensive insights into test performance and health
        </p>
      </div>

      <DashboardSectionNav
        failedOnly={failedOnly}
        onFailedOnlyChange={setFailedOnly}
        dateRange={dateRange}
        onDateRangeChange={onDateRangeChange}
        project={project}
        onProjectChange={onProjectChange}
      />

      <section id="overview" className="scroll-mt-32">
        <OverviewStatsCard
          stats={overviewStats!}
          totalTests={testsSummary?.total}
          flakyCount={testsSummary?.flakyCount}
          totalRuns={runHealthMetrics.length}
        />
      </section>

      <section id="trends" className="scroll-mt-32 space-y-6">
        <TrendSparklines metrics={trendMetrics!} isLoading={isLoading} />
        <HealthGrid metrics={runHealthMetrics} isLoading={isLoading} />
      </section>

      <section id="failures" className="scroll-mt-32 space-y-6">
        {(failureCategoryResponse?.data?.totalFailures ?? 0) > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <FailureCategoryChart
              categories={failureCategoryResponse?.data?.categories}
              totalFailures={failureCategoryResponse?.data?.totalFailures}
              isLoading={isLoadingFailures}
            />
            <TopFailuresWidget
              errors={failureCategoryResponse?.data?.topErrors}
              isLoading={isLoadingFailures}
            />
          </div>
        )}

        <FailureAnalysisSummary
          project={project}
          dateRange={dateRange}
          totalFailures={failureCategoryResponse?.data?.totalFailures}
        />
      </section>

      <section id="tests" className="scroll-mt-32">
        <TestManagementWidget project={project} dateRange={dateRange} />
      </section>

      {!isLoading && runHealthMetrics.length === 0 && (
        <div className="bg-warning-50 border border-warning/30 rounded-lg p-6">
          <div className="text-center">
            <div className="text-warning-900 font-medium mb-2">Limited Data Available</div>
            <div className="text-warning text-sm">
              Analytics insights become more meaningful with at least 5-10 test runs. Continue
              generating reports to see detailed trends and patterns.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DashboardSectionNav({
  failedOnly,
  onFailedOnlyChange,
  dateRange,
  onDateRangeChange,
  project,
  onProjectChange,
}: DashboardSectionNavProps) {
  const ids = DASHBOARD_SECTIONS.map((s) => s.id);
  const active = useActiveSection(ids);

  return (
    <nav className="sticky top-14 z-30 -mx-4 px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border/40">
      <div className="flex flex-col gap-2 py-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-1 overflow-x-auto text-sm">
          {DASHBOARD_SECTIONS.map((item) => {
            const isActive = active === item.id;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'whitespace-nowrap rounded-md px-3 py-1.5 transition-colors shrink-0',
                  isActive
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                {item.label}
              </a>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor="dashboard-only-failures"
            className="flex items-center gap-2 text-sm select-none cursor-pointer"
          >
            <Switch
              id="dashboard-only-failures"
              checked={failedOnly}
              onCheckedChange={onFailedOnlyChange}
            />
            <span className={failedOnly ? 'font-medium text-danger' : 'text-muted-foreground'}>
              Only failures
            </span>
          </label>
          <DateRangeSelect
            selectedRange={dateRange}
            onSelect={onDateRangeChange}
            showLabel={false}
            className="h-9 w-full sm:w-44 sm:min-w-32"
          />
          <ProjectSelect
            entity="report"
            onSelect={onProjectChange}
            selectedProject={project}
            showLabel={false}
            className="h-9 w-full sm:w-44 sm:min-w-32"
          />
        </div>
      </div>
    </nav>
  );
}

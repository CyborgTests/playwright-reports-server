'use client';

import type { DateRange } from '@playwright-reports/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAnalyticsData } from '../../hooks/useAnalyticsData';
import { useConfig } from '../../hooks/useConfig';
import { useFailureCategoryData } from '../../hooks/useFailureCategoryData';
import useQuery from '../../hooks/useQuery';
import { defaultProjectName } from '../../lib/constants';
import DateRangeSelect from '../date-range-select';
import ProjectSelect from '../project-select';
import TestManagementWidget from '../test-management/TestManagementWidget';
import { FailureAnalysisSummary } from './FailureAnalysisSummary';
import { FailureCategoryChart } from './FailureCategoryChart';
import { HealthGrid } from './HealthGrid';
import { OverviewStatsCard } from './OverviewStats';
import { TopFailuresWidget } from './TopFailuresWidget';
import { TrendSparklines } from './TrendSparklines';

export default function AnalyticsDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [project, setProject] = useState(searchParams.get('project') ?? defaultProjectName);
  const [dateRange, setDateRangeState] = useState<DateRange>(() => ({
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
  }));

  // Reflect filter state into URL search params so the view is shareable.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (project && project !== defaultProjectName) next.set('project', project);
    else next.delete('project');
    if (dateRange.from) next.set('from', dateRange.from);
    else next.delete('from');
    if (dateRange.to) next.set('to', dateRange.to);
    else next.delete('to');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [project, dateRange, searchParams, setSearchParams]);

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
  } = useAnalyticsData(project, dateRange);
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
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Analytics Dashboard</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Comprehensive insights into test performance and health
          </p>
        </div>
        <div className="flex justify-end items-end gap-3 flex-wrap">
          <DateRangeSelect label="Period" selectedRange={dateRange} onSelect={onDateRangeChange} />
          <ProjectSelect
            label="Select project"
            entity="report"
            onSelect={onProjectChange}
            selectedProject={project}
          />
        </div>
      </div>

      <OverviewStatsCard
        stats={overviewStats!}
        totalTests={testsSummary?.total}
        flakyCount={testsSummary?.flakyCount}
        totalRuns={runHealthMetrics.length}
      />
      <TrendSparklines metrics={trendMetrics!} isLoading={isLoading} />

      <HealthGrid metrics={runHealthMetrics} isLoading={isLoading} />

      {(failureCategoryResponse?.data?.totalFailures ?? 0) > 0 && (
        <>
          <FailureCategoryChart
            categories={failureCategoryResponse?.data?.categories}
            totalFailures={failureCategoryResponse?.data?.totalFailures}
            isLoading={isLoadingFailures}
          />
          <TopFailuresWidget
            errors={failureCategoryResponse?.data?.topErrors}
            isLoading={isLoadingFailures}
          />
        </>
      )}
      <FailureAnalysisSummary
        project={project}
        dateRange={dateRange}
        totalFailures={failureCategoryResponse?.data?.totalFailures}
      />

      <TestManagementWidget project={project} dateRange={dateRange} />

      {!isLoading && runHealthMetrics.length === 0 && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6">
          <div className="text-center">
            <div className="text-yellow-800 dark:text-yellow-200 font-medium mb-2">
              Limited Data Available
            </div>
            <div className="text-yellow-600 dark:text-yellow-400 text-sm">
              Analytics insights become more meaningful with at least 5-10 test runs. Continue
              generating reports to see detailed trends and patterns.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

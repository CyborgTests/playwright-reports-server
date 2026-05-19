'use client';

import type { DateRange } from '@playwright-reports/shared';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useActiveSection } from '../../hooks/useActiveSection';
import { useAnalyticsData } from '../../hooks/useAnalyticsData';
import { defaultProjectName } from '../../lib/constants';
import { cn } from '../../lib/utils';
import DateRangeSelect from '../date-range-select';
import LazyVisible from '../lazy-visible';
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
    data: analyticsData,
    error,
    isFetching,
    isPending,
  } = useAnalyticsData(project, dateRange, failedOnly);

  const onProjectChange = useCallback((project: string) => {
    setProject(project);
  }, []);

  const onDateRangeChange = useCallback((range: DateRange) => {
    setDateRangeState(range);
  }, []);

  const scrollToTests = useCallback(() => {
    document.getElementById('tests')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const applyTestsFilter = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      setSearchParams(next, { replace: true });
      // Scroll after the URL update so the lazy section is mounted by then.
      requestAnimationFrame(scrollToTests);
    },
    [searchParams, setSearchParams, scrollToTests]
  );

  const handleFlakyTileClick = useCallback(
    () => applyTestsFilter({ tiers: 'flaky,critical', sort: null }),
    [applyTestsFilter]
  );

  const handleSlowSparklineClick = useCallback(
    () => applyTestsFilter({ sort: 'slowest', tiers: null }),
    [applyTestsFilter]
  );

  error && toast.error(error.message);

  const isLoading = isPending || isFetching;

  if (!isLoading && !analyticsData) {
    return (
      <div className="w-[min(100%, 1200px)] mx-auto">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="text-muted-foreground text-lg">No analytics data available.</div>
          <div className="text-muted-foreground/80 text-sm mt-2">
            Generate some reports first to see analytics.
          </div>
        </div>
      </div>
    );
  }

  const {
    overviewStats,
    runHealthMetrics = [],
    trendMetrics,
    testsSummary,
    failureCategories,
  } = analyticsData ?? {};
  const totalFailures = failureCategories?.totalFailures ?? 0;

  return (
    <div className="w-[min(100%, 1200px)] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Analytics Dashboard</h1>
        <p className="text-muted-foreground mt-1">
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
          onFlakyClick={handleFlakyTileClick}
        />
      </section>

      <section id="trends" className="scroll-mt-32 space-y-6">
        <TrendSparklines
          metrics={trendMetrics!}
          isLoading={isLoading}
          onSlowClick={handleSlowSparklineClick}
          onFlakyClick={handleFlakyTileClick}
        />
        <HealthGrid metrics={runHealthMetrics} isLoading={isLoading} />
      </section>

      <section id="failures" className="scroll-mt-32 space-y-6">
        {totalFailures > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <FailureCategoryChart
              categories={failureCategories?.categories}
              totalFailures={totalFailures}
              isLoading={isLoading}
            />
            <TopFailuresWidget errors={failureCategories?.topErrors} isLoading={isLoading} />
          </div>
        )}

        <LazyVisible rootMargin="200px 0px">
          <FailureAnalysisSummary
            project={project}
            reportIds={runHealthMetrics.map((m) => m.runId)}
            totalFailures={totalFailures}
          />
        </LazyVisible>
      </section>

      <section id="tests" className="scroll-mt-32">
        <LazyVisible rootMargin="200px 0px" minHeight={320}>
          <TestManagementWidget project={project} dateRange={dateRange} />
        </LazyVisible>
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
            className="h-9 w-full sm:w-80 sm:min-w-72"
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

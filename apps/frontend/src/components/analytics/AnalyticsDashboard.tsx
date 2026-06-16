import type { DateRange, RegressionsAggregate } from '@playwright-reports/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useActiveSection } from '../../hooks/useActiveSection';
import { useAnalyticsData } from '../../hooks/useAnalyticsData';
import { defaultProjectName } from '../../lib/constants';
import { cn } from '../../lib/utils';
import DateRangeSelect, { readStoredDateRange } from '../date-range-select';
import LazyVisible from '../lazy-visible';
import ProjectSelect, { readStoredProject } from '../project-select';
import TestManagementWidget from '../test-management/TestManagementWidget';
import { Switch } from '../ui/switch';
import { FailureAnalysisSummary } from './FailureAnalysisSummary';
import { FailureCategoryChart } from './FailureCategoryChart';
import { HealthGrid } from './HealthGrid';
import { OverviewStatsCard } from './OverviewStats';
import { RegressionsStrip } from './RegressionsStrip';
import { TopFailuresWidget } from './TopFailuresWidget';
import { TrendSparklines } from './TrendSparklines';

const DASHBOARD_SECTIONS: Array<{ id: string; label: string }> = [
  { id: 'stats', label: 'Stats' },
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
  regressions?: RegressionsAggregate;
  isLoadingRegressions?: boolean;
  onActiveRegressionsClick: () => void;
  onNewRegressionsClick: () => void;
  onResolvedRegressionsClick: () => void;
  activeRegressionFilter?: 'active' | 'new' | 'resolved' | null;
}

export default function AnalyticsDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [project, setProject] = useState(
    () => searchParams.get('project') ?? readStoredProject() ?? defaultProjectName
  );
  const [dateRange, setDateRangeState] = useState<DateRange>(() => {
    const fromUrl = searchParams.get('from') ?? undefined;
    const toUrl = searchParams.get('to') ?? undefined;
    if (fromUrl || toUrl) return { from: fromUrl, to: toUrl };
    return readStoredDateRange() ?? {};
  });
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

  const handleCategoryClick = useCallback(
    (category: string) => applyTestsFilter({ failureCategory: category }),
    [applyTestsFilter]
  );

  const activeRegressionFilter = ((): 'active' | 'new' | 'resolved' | null => {
    const ro = searchParams.get('regressedOnly') === '1';
    const rs = searchParams.get('regressedSince');
    const re = searchParams.get('resolvedSince');
    if (re && !ro && !rs) return 'resolved';
    if (rs && !ro && !re) return 'new';
    if (ro && !rs && !re) return 'active';
    return null;
  })();

  const clearRegressionFilters = useCallback(
    () =>
      applyTestsFilter({
        regressedOnly: null,
        regressedSince: null,
        resolvedSince: null,
      }),
    [applyTestsFilter]
  );

  const handleActiveRegressionsClick = useCallback(() => {
    const alreadyActive =
      searchParams.get('regressedOnly') === '1' &&
      !searchParams.get('regressedSince') &&
      !searchParams.get('resolvedSince');
    if (alreadyActive) {
      clearRegressionFilters();
      return;
    }
    applyTestsFilter({
      regressedOnly: '1',
      regressedSince: null,
      resolvedSince: null,
      tiers: null,
      sort: null,
    });
  }, [applyTestsFilter, clearRegressionFilters, searchParams]);

  const handleNewRegressionsClick = useCallback(() => {
    const target = dateRange.from ?? null;
    const alreadyActive =
      searchParams.get('regressedSince') === target &&
      searchParams.get('regressedOnly') !== '1' &&
      !searchParams.get('resolvedSince');
    if (alreadyActive) {
      clearRegressionFilters();
      return;
    }
    applyTestsFilter({
      regressedOnly: null,
      regressedSince: target,
      resolvedSince: null,
      tiers: null,
      sort: null,
    });
  }, [applyTestsFilter, clearRegressionFilters, dateRange.from, searchParams]);

  const handleResolvedRegressionsClick = useCallback(() => {
    const target = dateRange.from ?? null;
    const alreadyActive =
      searchParams.get('resolvedSince') === target &&
      !searchParams.get('regressedOnly') &&
      !searchParams.get('regressedSince');
    if (alreadyActive) {
      clearRegressionFilters();
      return;
    }
    applyTestsFilter({
      regressedOnly: null,
      regressedSince: null,
      resolvedSince: target,
      tiers: null,
      sort: null,
    });
  }, [applyTestsFilter, clearRegressionFilters, dateRange.from, searchParams]);

  useEffect(() => {
    if (error) toast.error(error.message);
  }, [error]);

  const isLoading = isPending;

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
    regressions,
  } = analyticsData ?? {};
  const totalFailures = failureCategories?.totalFailures ?? 0;

  return (
    <div className="w-[min(100%, 1200px)] mx-auto space-y-6">
      <DashboardSectionNav
        failedOnly={failedOnly}
        onFailedOnlyChange={setFailedOnly}
        dateRange={dateRange}
        onDateRangeChange={onDateRangeChange}
        project={project}
        onProjectChange={onProjectChange}
        regressions={regressions}
        isLoadingRegressions={isLoading}
        onActiveRegressionsClick={handleActiveRegressionsClick}
        onNewRegressionsClick={handleNewRegressionsClick}
        onResolvedRegressionsClick={handleResolvedRegressionsClick}
        activeRegressionFilter={activeRegressionFilter}
      />

      <section id="stats" className="scroll-mt-40">
        <OverviewStatsCard
          stats={overviewStats}
          totalTests={testsSummary?.total}
          flakyCount={testsSummary?.flakyCount}
          totalRuns={runHealthMetrics.length}
          onFlakyClick={handleFlakyTileClick}
        />
        <TrendSparklines
          metrics={trendMetrics}
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
              onCategoryClick={handleCategoryClick}
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
  regressions,
  isLoadingRegressions,
  onActiveRegressionsClick,
  onNewRegressionsClick,
  onResolvedRegressionsClick,
  activeRegressionFilter,
}: DashboardSectionNavProps) {
  const ids = DASHBOARD_SECTIONS.map((s) => s.id);
  const active = useActiveSection(ids);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollRef.current;
    const el = container?.querySelector<HTMLElement>(`[data-section-id="${active}"]`);
    if (!container || !el) return;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const current = eRect.left - cRect.left;
    const desired = (container.clientWidth - el.offsetWidth) / 2;
    container.scrollTo({ left: container.scrollLeft + (current - desired), behavior: 'smooth' });
  }, [active]);

  return (
    <nav className="sticky top-14 z-30 -mx-4 px-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border/40">
      <div className="flex flex-col gap-2 py-2 lg:flex-row lg:items-center lg:justify-between">
        <div
          ref={scrollRef}
          className="flex items-center gap-1 overflow-x-auto text-sm min-w-0 flex-1"
        >
          {DASHBOARD_SECTIONS.map((item) => {
            const isActive = active === item.id;
            return (
              <a
                key={item.id}
                data-section-id={item.id}
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
          <RegressionsStrip
            regressions={regressions}
            isLoading={isLoadingRegressions}
            onActiveClick={onActiveRegressionsClick}
            onNewClick={onNewRegressionsClick}
            onResolvedClick={onResolvedRegressionsClick}
            activeFilter={activeRegressionFilter}
          />
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

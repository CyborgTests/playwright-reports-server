import {
  type DateRange,
  FLAKINESS_THRESHOLDS,
  type FlakinessTier,
  formatDuration,
  type TestFilters,
  type TestsSort,
  type TestWithQuarantineInfo,
} from '@playwright-reports/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AlertTriangle, Clock, RotateCcw } from 'lucide-react';
import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { TrendSparklineHistory } from '@/components/analytics/TrendSparklineHistory';
import { outcomeBadge } from '@/components/outcome-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useConfig } from '@/hooks/useConfig';
import { defaultProjectName } from '@/lib/constants';
import { formatRegressionAge, getStatusBadge } from './badges';
import { exponentialMovingAverageDuration } from './calculations/ema';
import { TestFilters as TestFiltersComponent } from './TestFilters';
import { DeleteTestDialog, QuarantineDialog } from './TestManagementDialogs';
import { useTestMutations, useTestsQuery } from './useTestManagement';

interface TestManagementWidgetProps {
  project?: string;
  dateRange?: DateRange;
}

const VALID_TIERS: FlakinessTier[] = ['stable', 'flaky', 'critical'];

function parseTiersParam(raw: string | null): FlakinessTier[] | undefined {
  if (!raw) return undefined;
  const tiers = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t): t is FlakinessTier => (VALID_TIERS as string[]).includes(t));
  return tiers.length > 0 ? tiers : undefined;
}

function parseSortParam(raw: string | null): TestsSort | undefined {
  if (raw === 'slowest' || raw === 'stale' || raw === 'regression-age') return raw;
  return undefined;
}

interface TestRowProps {
  item: TestWithQuarantineInfo;
  warningThreshold: number;
  quarantineThreshold: number;
  stale: boolean;
  regressionFilterActive: boolean;
  regressionHighlightMode: 'opened' | 'closed' | null;
  isResetFlakinessPending: boolean;
  isClearFlakinessResetPending: boolean;
  onQuarantine: (test: TestWithQuarantineInfo) => void;
  onResetFlakiness: (test: TestWithQuarantineInfo) => void;
  onClearFlakinessReset: (test: TestWithQuarantineInfo) => void;
  onDelete: (test: TestWithQuarantineInfo) => void;
}

const TestRow = memo(
  forwardRef<HTMLTableRowElement, TestRowProps & { dataIndex: number }>(function TestRow(
    {
      item,
      warningThreshold,
      quarantineThreshold,
      stale,
      regressionFilterActive,
      regressionHighlightMode,
      isResetFlakinessPending,
      isClearFlakinessResetPending,
      onQuarantine,
      onResetFlakiness,
      onClearFlakinessReset,
      onDelete,
      dataIndex,
    },
    ref
  ) {
    const highlights =
      regressionFilterActive && item.regressionHighlights
        ? regressionHighlightMode === 'closed'
          ? { resolvedAtReportId: item.regressionHighlights.resolvedAtReportId }
          : { newAtReportId: item.regressionHighlights.newAtReportId }
        : undefined;

    return (
      <TableRow ref={ref} data-index={dataIndex}>
        <TableCell className="break-words">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <RouterLink
                to={`/test/${item.testId}?project=${encodeURIComponent(item.project)}`}
                className="font-medium break-words hover:underline"
              >
                {item.title}
              </RouterLink>
              {item.regression && (
                <Badge
                  variant="danger"
                  title={`Regression · opened ${new Date(item.regression.regressedAt).toLocaleString()} · ${item.regression.failureCount} failing run${item.regression.failureCount === 1 ? '' : 's'} since`}
                  className="gap-1 text-[10px] px-1.5 py-0"
                >
                  Regression · {formatRegressionAge(item.regression.daysOpen)}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground break-words">{item.filePath}</p>
          </div>
        </TableCell>
        <TableCell className="break-words">
          <p className="text-sm break-words">{item.project}</p>
        </TableCell>
        <TableCell className="whitespace-nowrap w-px">
          {outcomeBadge(item.runs?.at(0)?.outcome)}
        </TableCell>
        <TableCell className="whitespace-nowrap w-px">
          {getStatusBadge(item, warningThreshold, quarantineThreshold)}
        </TableCell>
        <TableCell className="whitespace-nowrap w-px relative">
          <div className="flex items-center gap-2">
            <Progress value={item.flakinessScore || 0} className="max-w-[100px] h-2" />
            <span className="text-sm">{item.flakinessScore?.toFixed(1)}%</span>
          </div>
          {item.flakinessResetAt && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <RotateCcw className="absolute top-7 right-0 h-3 w-3 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  Flakiness reset on {new Date(item.flakinessResetAt).toLocaleString()}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap w-px">
          <Badge variant="outline">{item.totalRuns || 0}</Badge>
        </TableCell>
        <TableCell className="whitespace-nowrap w-px">
          <TrendSparklineHistory runs={item.runs ?? []} highlights={highlights} />
        </TableCell>
        <TableCell className="whitespace-nowrap w-px">
          <span className="flex items-center">
            <Clock className="h-4 w-4 mr-1" />
            {formatDuration(exponentialMovingAverageDuration(item.runs))}
          </span>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1 break-words">
            {item.lastRunAt ? new Date(item.lastRunAt).toLocaleString() : 'Never'}
            {stale && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <AlertTriangle className="h-4 w-4 text-warning" />
                  </TooltipTrigger>
                  <TooltipContent>Not present in latest report - consider removing</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </TableCell>

        <TableCell className="whitespace-nowrap w-px">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                Actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={() => onQuarantine(item)}
                className={item.isQuarantined ? 'text-success' : 'text-danger'}
              >
                {item.isQuarantined ? 'Remove Quarantine' : 'Send Quarantine'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onResetFlakiness(item)}
                disabled={isResetFlakinessPending}
              >
                Reset Flakiness Score
              </DropdownMenuItem>
              {item.flakinessResetAt && (
                <DropdownMenuItem
                  onClick={() => onClearFlakinessReset(item)}
                  disabled={isClearFlakinessResetPending}
                >
                  Remove Flakiness Reset
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onDelete(item)} className="text-danger">
                Delete Test
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    );
  })
);

export default function TestManagementWidget({
  project,
  dateRange,
}: Readonly<TestManagementWidgetProps>) {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo<TestFilters>(
    () => ({
      project: project ?? defaultProjectName,
      status: 'all',
      tiers: parseTiersParam(searchParams.get('tiers')),
      sort: parseSortParam(searchParams.get('sort')),
      failureCategory: searchParams.get('failureCategory') || undefined,
      search: searchParams.get('search') || undefined,
      regressedOnly: searchParams.get('regressedOnly') === '1',
      regressedSince: searchParams.get('regressedSince') || undefined,
      resolvedSince: searchParams.get('resolvedSince') || undefined,
    }),
    [project, searchParams]
  );
  const [quarantineTest, setQuarantineTest] = useState<TestWithQuarantineInfo | null>(null);
  const [quarantineReason, setQuarantineReason] = useState('');
  const [isQuarantineModalOpen, setIsQuarantineModalOpen] = useState(false);
  const [deleteTest, setDeleteTest] = useState<TestWithQuarantineInfo | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const handleFiltersChange = useCallback(
    (next: TestFilters) => {
      const params = new URLSearchParams(searchParams);
      if (next.tiers && next.tiers.length > 0) params.set('tiers', next.tiers.join(','));
      else params.delete('tiers');
      if (next.sort && next.sort !== 'default') params.set('sort', next.sort);
      else params.delete('sort');
      if (next.regressedOnly) params.set('regressedOnly', '1');
      else params.delete('regressedOnly');
      if (next.regressedSince) params.set('regressedSince', next.regressedSince);
      else params.delete('regressedSince');
      if (next.resolvedSince) params.set('resolvedSince', next.resolvedSince);
      else params.delete('resolvedSince');
      if (next.failureCategory) params.set('failureCategory', next.failureCategory);
      else params.delete('failureCategory');
      if (next.search) params.set('search', next.search);
      else params.delete('search');
      if (params.toString() !== searchParams.toString()) {
        setSearchParams(params, { replace: true });
      }
    },
    [searchParams, setSearchParams]
  );

  const { data: config } = useConfig();

  const warningThreshold =
    config?.testManagement?.warningThresholdPercentage ?? FLAKINESS_THRESHOLDS.WARNING_PERCENTAGE;
  const quarantineThreshold =
    config?.testManagement?.quarantineThresholdPercentage ??
    FLAKINESS_THRESHOLDS.QUARANTINE_PERCENTAGE;

  const { tests, totalTests, isLoadingTests, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useTestsQuery({ filters, dateRange });

  const tableContainerRef = useRef<HTMLDivElement>(null);

  const {
    updateQuarantineMutation,
    isUpdateQuarantinePending,
    deleteTestMutation,
    isDeletePending,
    resetFlakinessMutation,
    isResetFlakinessPending,
    clearFlakinessResetMutation,
    isClearFlakinessResetPending,
  } = useTestMutations({
    onQuarantineSuccess: () => {
      setIsQuarantineModalOpen(false);
      setQuarantineReason('');
    },
    onDeleteSuccess: () => {
      setIsDeleteModalOpen(false);
      setDeleteTest(null);
    },
  });

  const handleResetFlakiness = useCallback(
    (test: TestWithQuarantineInfo) => {
      resetFlakinessMutation({
        path: `/api/test/${test.testId}/flakiness-reset?project=${encodeURIComponent(test.project)}`,
      });
    },
    [resetFlakinessMutation]
  );

  const handleClearFlakinessReset = useCallback(
    (test: TestWithQuarantineInfo) => {
      clearFlakinessResetMutation({
        path: `/api/test/${test.testId}/flakiness-reset?project=${encodeURIComponent(test.project)}`,
      });
    },
    [clearFlakinessResetMutation]
  );

  // virtualize the (unbounded, infinite-scrolled) rows: only the visible window
  // is in the DOM. Rows are variable-height, so heights are measured live via
  // measureElement; estimateSize is just the initial guess.
  const rowVirtualizer = useVirtualizer({
    count: tests.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 84,
    overscan: 8,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0 ? totalSize - virtualRows[virtualRows.length - 1].end : 0;

  // Load the next page once the last row is rendered (replaces the old
  // IntersectionObserver sentinel, which can't exist outside the virtual window).
  useEffect(() => {
    const lastItem = virtualRows[virtualRows.length - 1];
    if (lastItem && lastItem.index >= tests.length - 1 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [virtualRows, tests.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const regressionFilterActive =
    !!filters.regressedOnly || !!filters.regressedSince || !!filters.resolvedSince;
  const regressionHighlightMode: 'opened' | 'closed' | null = filters.resolvedSince
    ? 'closed'
    : filters.regressedOnly || filters.regressedSince
      ? 'opened'
      : null;

  const handleQuarantineAction = useCallback((test: TestWithQuarantineInfo) => {
    setQuarantineTest(test);
    if (!test.isQuarantined) {
      setQuarantineReason('');
    }
    setIsQuarantineModalOpen(true);
  }, []);

  const latestReportByProject = useMemo(() => {
    const map = new Map<string, string>();
    for (const test of tests) {
      const latestRun = test.runs?.at(0);
      if (!latestRun?.createdAt) continue;
      const current = map.get(test.project);
      if (!current || latestRun.createdAt > current) {
        map.set(test.project, latestRun.reportId);
      }
    }
    return map;
  }, [tests]);

  const isStale = (test: TestWithQuarantineInfo) => {
    const latestRun = test.runs?.at(0);
    if (!latestRun) return true;
    const latestReportId = latestReportByProject.get(test.project);
    return latestReportId ? latestRun.reportId !== latestReportId : false;
  };

  const handleDeleteAction = useCallback((test: TestWithQuarantineInfo) => {
    setDeleteTest(test);
    setIsDeleteModalOpen(true);
  }, []);

  const handleDeleteSubmit = () => {
    if (!deleteTest) return;
    deleteTestMutation({
      path: `/api/test/${deleteTest.testId}?project=${encodeURIComponent(deleteTest.project)}`,
    });
  };

  const handleQuarantineSubmit = () => {
    if (!quarantineTest) return;

    const isQuarantined = !quarantineTest.isQuarantined;

    if (isQuarantined && !quarantineReason?.trim()) {
      toast.error('Please provide a reason for quarantine');
      return;
    }

    updateQuarantineMutation({
      body: {
        test: quarantineTest,
        isQuarantined,
        reason: quarantineReason,
      },
      path: `/api/test/${quarantineTest.testId}?project=${encodeURIComponent(quarantineTest.project)}`,
    });
  };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Test Management</h2>
        <p className="text-muted-foreground mt-1">
          Monitor test health and manage quarantine status
        </p>
      </div>

      <Card className="mb-4">
        <CardContent className="pt-6">
          <TestFiltersComponent filters={filters} onFiltersChange={handleFiltersChange} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Tests</h3>
            {!isLoadingTests && (
              <span className="text-sm text-muted-foreground">
                Showing {tests.length} of {totalTests}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingTests ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : (
            <div ref={tableContainerRef} className="rounded-md border overflow-auto max-h-[70vh]">
              <table className="w-full caption-bottom text-sm">
                <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card">
                  <TableRow>
                    <TableHead className="min-w-[240px]">Test Name</TableHead>
                    <TableHead className="min-w-[120px]">Project</TableHead>
                    <TableHead className="whitespace-nowrap w-px">Outcome (latest)</TableHead>
                    <TableHead className="whitespace-nowrap w-px">Is Flaky</TableHead>
                    <TableHead className="whitespace-nowrap w-px">Flakiness Score</TableHead>
                    <TableHead className="whitespace-nowrap w-px">Total Runs</TableHead>
                    <TableHead className="whitespace-nowrap w-px">
                      History (first to last)
                    </TableHead>
                    <TableHead className="whitespace-nowrap w-px">Duration (Avg)</TableHead>
                    <TableHead className="min-w-[160px]">Last Run</TableHead>
                    <TableHead className="whitespace-nowrap w-px">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paddingTop > 0 && (
                    <tr>
                      <td colSpan={10} style={{ height: paddingTop }} />
                    </tr>
                  )}
                  {virtualRows.map((virtualRow) => {
                    const item = tests[virtualRow.index];
                    return (
                      <TestRow
                        key={`${item.testId}-${item.fileId}-${item.project}`}
                        ref={rowVirtualizer.measureElement}
                        dataIndex={virtualRow.index}
                        item={item}
                        warningThreshold={warningThreshold}
                        quarantineThreshold={quarantineThreshold}
                        stale={isStale(item)}
                        regressionFilterActive={regressionFilterActive}
                        regressionHighlightMode={regressionHighlightMode}
                        isResetFlakinessPending={isResetFlakinessPending}
                        isClearFlakinessResetPending={isClearFlakinessResetPending}
                        onQuarantine={handleQuarantineAction}
                        onResetFlakiness={handleResetFlakiness}
                        onClearFlakinessReset={handleClearFlakinessReset}
                        onDelete={handleDeleteAction}
                      />
                    );
                  })}
                  {paddingBottom > 0 && (
                    <tr>
                      <td colSpan={10} style={{ height: paddingBottom }} />
                    </tr>
                  )}
                  {tests.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                        No tests found
                      </TableCell>
                    </TableRow>
                  )}
                  {isFetchingNextPage && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-4">
                        <Spinner size="sm" />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </table>
            </div>
          )}
          <div className="mt-4 text-xs text-muted-foreground border-t pt-3 w-full">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 bg-success rounded"></span>
                <span>Passed run</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 bg-danger rounded"></span>
                <span>Failed run</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <QuarantineDialog
        open={isQuarantineModalOpen}
        onOpenChange={setIsQuarantineModalOpen}
        test={quarantineTest}
        reason={quarantineReason}
        onReasonChange={setQuarantineReason}
        onSubmit={handleQuarantineSubmit}
        isPending={isUpdateQuarantinePending}
      />

      <DeleteTestDialog
        open={isDeleteModalOpen}
        onOpenChange={setIsDeleteModalOpen}
        test={deleteTest}
        onSubmit={handleDeleteSubmit}
        isPending={isDeletePending}
      />
    </div>
  );
}

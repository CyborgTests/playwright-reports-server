import {
  type DateRange,
  FLAKINESS_THRESHOLDS,
  type TestFilters,
  type TestWithQuarantineInfo,
} from '@playwright-reports/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useConfig } from '@/hooks/useConfig';
import { buildFilterParams, parseTestFilters } from './filter-params';
import { TestFilters as TestFiltersComponent } from './TestFilters';
import { DeleteTestDialog, QuarantineDialog } from './TestManagementDialogs';
import { TestRow } from './TestRow';
import { useTestMutations, useTestsQuery } from './useTestManagement';

interface TestManagementWidgetProps {
  project?: string;
  dateRange?: DateRange;
}

export default function TestManagementWidget({
  project,
  dateRange,
}: Readonly<TestManagementWidgetProps>) {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo<TestFilters>(
    () => parseTestFilters(searchParams, project),
    [project, searchParams]
  );
  const [quarantineTest, setQuarantineTest] = useState<TestWithQuarantineInfo | null>(null);
  const [quarantineReason, setQuarantineReason] = useState('');
  const [isQuarantineModalOpen, setIsQuarantineModalOpen] = useState(false);
  const [deleteTest, setDeleteTest] = useState<TestWithQuarantineInfo | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const handleFiltersChange = useCallback(
    (next: TestFilters) => {
      const params = buildFilterParams(next, searchParams);
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
    const map = new Map<string, { createdAt: string; reportId: string }>();
    for (const test of tests) {
      const latestRun = test.runs?.at(0);
      if (!latestRun?.createdAt) continue;
      const current = map.get(test.project);
      if (!current || latestRun.createdAt > current.createdAt) {
        map.set(test.project, { createdAt: latestRun.createdAt, reportId: latestRun.reportId });
      }
    }
    return map;
  }, [tests]);

  const isStale = (test: TestWithQuarantineInfo) => {
    const latestRun = test.runs?.at(0);
    if (!latestRun) return true;
    const latest = latestReportByProject.get(test.project);
    return latest ? latestRun.reportId !== latest.reportId : false;
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

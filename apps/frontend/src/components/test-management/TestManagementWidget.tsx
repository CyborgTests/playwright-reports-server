import {
  type DateRange,
  ReportTestOutcomeEnum,
  type TestFilters,
  type TestWithQuarantineInfo,
} from '@playwright-reports/shared';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { parseMilliseconds } from '@/lib/time';
import { useAuth } from '../../hooks/useAuth';
import { useConfig } from '../../hooks/useConfig';
import useMutation from '../../hooks/useMutation';
import { defaultProjectName } from '../../lib/constants';
import { invalidateCache } from '../../lib/query-cache';
import { withBase } from '../../lib/url';
import { TrendSparklineHistory } from '../analytics/TrendSparklineHistory';
import { exponentialMovingAverageDuration } from './calculations/ema';
import { TestFilters as TestFiltersComponent } from './TestFilters';

interface TestManagementWidgetProps {
  project?: string;
  dateRange?: DateRange;
}

export default function TestManagementWidget({
  project,
  dateRange,
}: Readonly<TestManagementWidgetProps>) {
  const [filters, setFilters] = useState<TestFilters>({
    project: project ?? defaultProjectName,
    status: 'all',
    flakinessMin: 0,
    flakinessMax: 100,
  });
  const [quarantineTest, setQuarantineTest] = useState<TestWithQuarantineInfo | null>(null);
  const [quarantineReason, setQuarantineReason] = useState('');
  const [isQuarantineModalOpen, setIsQuarantineModalOpen] = useState(false);
  const [deleteTest, setDeleteTest] = useState<TestWithQuarantineInfo | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  useEffect(() => {
    setFilters((prev) => ({ ...prev, project: project ?? defaultProjectName }));
  }, [project]);

  const queryClient = useQueryClient();

  const { data: config } = useConfig();
  const session = useAuth();

  const warningThreshold = config?.testManagement?.warningThresholdPercentage ?? 10;
  const quarantineThreshold = config?.testManagement?.quarantineThresholdPercentage ?? 50;

  const PAGE_SIZE = 25;

  const buildQueryParams = useCallback(
    (offset: number) => {
      const params = new URLSearchParams();
      if (filters.project && filters.project !== defaultProjectName) {
        params.append('project', filters.project);
      }
      if (filters.status && filters.status !== 'all') {
        params.append('status', filters.status);
      }
      if (filters.flakinessMin !== undefined && filters.flakinessMin > 0) {
        params.append('flakinessMin', filters.flakinessMin.toString());
      }
      if (filters.flakinessMax !== undefined && filters.flakinessMax < 100) {
        params.append('flakinessMax', filters.flakinessMax.toString());
      }
      if (filters.search) {
        params.append('search', filters.search);
      }
      if (dateRange?.from) params.append('from', dateRange.from);
      if (dateRange?.to) params.append('to', dateRange.to);
      params.append('limit', PAGE_SIZE.toString());
      params.append('offset', offset.toString());
      return params.toString();
    },
    [filters, dateRange?.from, dateRange?.to]
  );

  const isAuthDisabled = session.status === 'authenticated' && session.data === null;
  const isAuthReady = isAuthDisabled || session.status === 'authenticated';

  const {
    data: testsData,
    isLoading: isLoadingTests,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<{ data: TestWithQuarantineInfo[]; total: number }>({
    queryKey: ['/api/tests', filters, dateRange?.from, dateRange?.to],
    queryFn: async ({ pageParam }) => {
      const headers: HeadersInit = {};
      const jwtToken = typeof window !== 'undefined' ? localStorage.getItem('jwtToken') : null;
      if (jwtToken && session.status === 'authenticated' && session.data !== null) {
        headers.Authorization = `Bearer ${jwtToken}`;
      }
      const res = await fetch(withBase(`/api/tests?${buildQueryParams(pageParam as number)}`), {
        headers,
      });
      if (!res.ok) throw new Error('Failed to fetch tests');
      return res.json();
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.data.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
    enabled: isAuthReady,
  });

  const sentinelRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const { mutate: updateQuarantineMutation, isPending: isUpdateQuarantinePending } = useMutation(
    '/api/test',
    {
      method: 'PATCH',
      onSuccess: (_, variables) => {
        invalidateCache(queryClient, { predicate: '/api/tests' });
        setIsQuarantineModalOpen(false);
        setQuarantineReason('');
        const test = (variables as { body: { test: TestWithQuarantineInfo } }).body.test;
        toast.success(
          test.isQuarantined ? 'Test removed from quarantine' : 'Test quarantined successfully'
        );
      },
    }
  );

  const { mutate: deleteTestMutation, isPending: isDeletePending } = useMutation('/api/test', {
    method: 'DELETE',
    onSuccess: () => {
      invalidateCache(queryClient, { predicate: '/api/tests' });
      setIsDeleteModalOpen(false);
      setDeleteTest(null);
      toast.success('Test deleted successfully');
    },
  });

  const tests = useMemo(() => testsData?.pages.flatMap((page) => page.data) ?? [], [testsData]);

  const totalTests = testsData?.pages[0]?.total ?? 0;

  const getOutcomeBadge = (outcome?: string) => {
    if (!outcome) return <span className="text-sm text-muted-foreground">—</span>;
    switch (outcome) {
      case ReportTestOutcomeEnum.Expected:
      case ReportTestOutcomeEnum.Passed:
        return <Badge variant="success">Passed</Badge>;
      case ReportTestOutcomeEnum.Flaky:
        return <Badge variant="warning">Flaky</Badge>;
      case ReportTestOutcomeEnum.Unexpected:
      case ReportTestOutcomeEnum.Failed:
        return <Badge variant="danger">Failed</Badge>;
      case ReportTestOutcomeEnum.Skipped:
        return <Badge variant="skipped">Skipped</Badge>;
      default:
        return <Badge variant="secondary">{outcome}</Badge>;
    }
  };

  const getStatusBadge = (test: TestWithQuarantineInfo) => {
    if (test.isQuarantined) {
      return (
        <Badge variant="destructive" className="gap-1">
          🔒 Quarantined
        </Badge>
      );
    }
    if (test.flakinessScore === undefined) {
      return <Badge variant="secondary">No Data</Badge>;
    }
    if (test.flakinessScore < warningThreshold) {
      return (
        <Badge variant="success" className="gap-1">
          Stable
        </Badge>
      );
    }
    if (test.flakinessScore < quarantineThreshold) {
      return (
        <Badge variant="warning" className="gap-1">
          Flaky
        </Badge>
      );
    }
    return (
      <Badge variant="danger" className="gap-1">
        Critical
      </Badge>
    );
  };

  const handleQuarantineAction = (test: TestWithQuarantineInfo) => {
    setQuarantineTest(test);
    if (!test.isQuarantined) {
      setQuarantineReason('');
    }
    setIsQuarantineModalOpen(true);
  };

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

  const handleDeleteAction = (test: TestWithQuarantineInfo) => {
    setDeleteTest(test);
    setIsDeleteModalOpen(true);
  };

  const handleDeleteSubmit = () => {
    if (!deleteTest) return;
    deleteTestMutation({
      path: `/api/test/${deleteTest.fileId}/${deleteTest.testId}?project=${deleteTest.project}`,
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
      path: `/api/test/${quarantineTest.fileId}/${quarantineTest.testId}?project=${quarantineTest.project}`,
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
          <TestFiltersComponent filters={filters} onFiltersChange={setFilters} />
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
            <div className="rounded-md border">
              <Table>
                <TableHeader>
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
                  {tests.map((item) => (
                    <TableRow key={`${item.testId}-${item.fileId}-${item.project}`}>
                      <TableCell className="break-words">
                        <div>
                          <p className="font-medium break-words">{item.title}</p>
                          <p className="text-sm text-muted-foreground break-words">
                            {item.filePath}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="break-words">
                        <p className="text-sm break-words">{item.project}</p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap w-px">
                        {getOutcomeBadge(item.runs?.at(0)?.outcome)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap w-px">
                        {getStatusBadge(item)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap w-px">
                        <div className="flex items-center gap-2">
                          <Progress
                            value={item.flakinessScore || 0}
                            className="max-w-[100px] h-2"
                          />
                          <span className="text-sm">{item.flakinessScore?.toFixed(1)}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap w-px">
                        <Badge variant="outline">{item.totalRuns || 0}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap w-px">
                        <TrendSparklineHistory runs={item.runs ?? []} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap w-px">
                        <span className="flex items-center">
                          <Clock className="h-4 w-4 mr-1" />
                          {parseMilliseconds(exponentialMovingAverageDuration(item.runs))}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 break-words">
                          {item.lastRunAt ? new Date(item.lastRunAt).toLocaleString() : 'Never'}
                          {isStale(item) && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <AlertTriangle className="h-4 w-4 text-warning" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  Not present in latest report — consider removing
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="whitespace-nowrap w-px">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              Actions
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onClick={() => handleQuarantineAction(item)}
                              className={item.isQuarantined ? 'text-success' : 'text-danger'}
                            >
                              {item.isQuarantined ? 'Remove Quarantine' : 'Send Quarantine'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleDeleteAction(item)}
                              className="text-danger"
                            >
                              Delete Test
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                  {tests.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                        No tests found
                      </TableCell>
                    </TableRow>
                  )}
                  {hasNextPage && (
                    <TableRow ref={sentinelRef}>
                      <TableCell colSpan={10} className="text-center py-4">
                        {isFetchingNextPage ? (
                          <Spinner size="sm" />
                        ) : (
                          <span className="text-sm text-muted-foreground">Scroll for more</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
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

      <Dialog open={isQuarantineModalOpen} onOpenChange={setIsQuarantineModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {quarantineTest?.isQuarantined ? 'Remove from Quarantine' : 'Quarantine Test'}
            </DialogTitle>
            <DialogDescription>
              {quarantineTest?.isQuarantined
                ? 'This test will be removed from quarantine and allowed to run again.'
                : 'This test will be quarantined and skipped in future runs.'}
            </DialogDescription>
          </DialogHeader>
          {quarantineTest && (
            <div className="space-y-4">
              <div>
                <p className="mb-4">
                  <strong>Test:</strong> {quarantineTest.title}
                </p>
                {!quarantineTest.isQuarantined && (
                  <Textarea
                    placeholder="Enter reason for quarantine..."
                    value={quarantineReason}
                    onChange={(e) => setQuarantineReason(e.target.value)}
                    required
                    rows={3}
                  />
                )}
                {quarantineTest.isQuarantined && quarantineTest.quarantineReason && (
                  <div className="bg-muted p-3 rounded-lg">
                    <p className="text-sm font-semibold mb-1">Current Reason:</p>
                    <p className="text-sm">{quarantineTest.quarantineReason}</p>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsQuarantineModalOpen(false)}
              disabled={isUpdateQuarantinePending}
            >
              Cancel
            </Button>
            <Button
              variant={quarantineTest?.isQuarantined ? 'default' : 'destructive'}
              onClick={handleQuarantineSubmit}
              disabled={isUpdateQuarantinePending}
            >
              {isUpdateQuarantinePending
                ? 'Saving...'
                : quarantineTest?.isQuarantined
                  ? 'Remove Quarantine'
                  : 'Quarantine Test'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Test</DialogTitle>
            <DialogDescription>
              This will permanently delete the test and all its run history. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          {deleteTest && (
            <div>
              <p>
                <strong>Test:</strong> {deleteTest.title}
              </p>
              <p className="text-sm text-muted-foreground">{deleteTest.filePath}</p>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteModalOpen(false)}
              disabled={isDeletePending}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteSubmit} disabled={isDeletePending}>
              {isDeletePending ? 'Deleting...' : 'Delete Test'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

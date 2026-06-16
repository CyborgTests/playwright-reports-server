import {
  type DateRange,
  FLAKINESS_THRESHOLDS,
  type FlakinessTier,
  ReportTestOutcomeEnum,
  type TestFilters,
  type TestsSort,
  type TestWithQuarantineInfo,
} from '@playwright-reports/shared';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock, RotateCcw } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
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

function formatRegressionAge(days: number): string {
  if (days < 1) return `${Math.round(days * 24)}h`;
  return `${Math.round(days * 10) / 10}d`;
}

function getOutcomeBadge(outcome?: string) {
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
}

function getStatusBadge(
  test: TestWithQuarantineInfo,
  warningThreshold: number,
  quarantineThreshold: number
) {
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
}

interface TestRowProps {
  item: TestWithQuarantineInfo;
  warningThreshold: number;
  quarantineThreshold: number;
  stale: boolean;
  regressionFilterActive: boolean;
  regressionHighlightMode: 'opened' | 'closed' | null;
  onQuarantine: (test: TestWithQuarantineInfo) => void;
  onResetFlakiness: (test: TestWithQuarantineInfo) => void;
  onClearFlakinessReset: (test: TestWithQuarantineInfo) => void;
  onDelete: (test: TestWithQuarantineInfo) => void;
}

const TestRow = memo(function TestRow({
  item,
  warningThreshold,
  quarantineThreshold,
  stale,
  regressionFilterActive,
  regressionHighlightMode,
  onQuarantine,
  onResetFlakiness,
  onClearFlakinessReset,
  onDelete,
}: TestRowProps) {
  const highlights =
    regressionFilterActive && item.regressionHighlights
      ? regressionHighlightMode === 'closed'
        ? { resolvedAtReportId: item.regressionHighlights.resolvedAtReportId }
        : { newAtReportId: item.regressionHighlights.newAtReportId }
      : undefined;

  return (
    <TableRow>
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
        {getOutcomeBadge(item.runs?.at(0)?.outcome)}
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
          {parseMilliseconds(exponentialMovingAverageDuration(item.runs))}
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
                <TooltipContent>Not present in latest report — consider removing</TooltipContent>
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
            <DropdownMenuItem onClick={() => onResetFlakiness(item)}>
              Reset Flakiness Score
            </DropdownMenuItem>
            {item.flakinessResetAt && (
              <DropdownMenuItem onClick={() => onClearFlakinessReset(item)}>
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
});

export default function TestManagementWidget({
  project,
  dateRange,
}: Readonly<TestManagementWidgetProps>) {
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFilters] = useState<TestFilters>(() => ({
    project: project ?? defaultProjectName,
    status: 'all',
    tiers: parseTiersParam(searchParams.get('tiers')),
    sort: parseSortParam(searchParams.get('sort')),
    failureCategory: searchParams.get('failureCategory') || undefined,
    search: searchParams.get('search') || undefined,
    regressedOnly: searchParams.get('regressedOnly') === '1',
    regressedSince: searchParams.get('regressedSince') || undefined,
    resolvedSince: searchParams.get('resolvedSince') || undefined,
  }));
  const [quarantineTest, setQuarantineTest] = useState<TestWithQuarantineInfo | null>(null);
  const [quarantineReason, setQuarantineReason] = useState('');
  const [isQuarantineModalOpen, setIsQuarantineModalOpen] = useState(false);
  const [deleteTest, setDeleteTest] = useState<TestWithQuarantineInfo | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  useEffect(() => {
    setFilters((prev) => ({ ...prev, project: project ?? defaultProjectName }));
  }, [project]);

  useEffect(() => {
    const urlTiers = parseTiersParam(searchParams.get('tiers'));
    const urlSort = parseSortParam(searchParams.get('sort'));
    const urlFailureCategory = searchParams.get('failureCategory') || undefined;
    const urlSearch = searchParams.get('search') || undefined;
    const urlRegressedOnly = searchParams.get('regressedOnly') === '1';
    const urlRegressedSince = searchParams.get('regressedSince') || undefined;
    const urlResolvedSince = searchParams.get('resolvedSince') || undefined;
    setFilters((prev) => {
      const sameTiers =
        (prev.tiers?.length ?? 0) === (urlTiers?.length ?? 0) &&
        (prev.tiers ?? []).every((t) => urlTiers?.includes(t));
      if (
        sameTiers &&
        prev.sort === urlSort &&
        prev.failureCategory === urlFailureCategory &&
        prev.search === urlSearch &&
        (prev.regressedOnly ?? false) === urlRegressedOnly &&
        prev.regressedSince === urlRegressedSince &&
        prev.resolvedSince === urlResolvedSince
      ) {
        return prev;
      }
      return {
        ...prev,
        tiers: urlTiers,
        sort: urlSort,
        failureCategory: urlFailureCategory,
        search: urlSearch,
        regressedOnly: urlRegressedOnly,
        regressedSince: urlRegressedSince,
        resolvedSince: urlResolvedSince,
      };
    });
  }, [searchParams]);

  const handleFiltersChange = useCallback(
    (next: TestFilters) => {
      setFilters(next);
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

  const queryClient = useQueryClient();

  const { data: config } = useConfig();
  const session = useAuth();

  const warningThreshold =
    config?.testManagement?.warningThresholdPercentage ?? FLAKINESS_THRESHOLDS.WARNING_PERCENTAGE;
  const quarantineThreshold =
    config?.testManagement?.quarantineThresholdPercentage ??
    FLAKINESS_THRESHOLDS.QUARANTINE_PERCENTAGE;

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
      if (filters.tiers && filters.tiers.length > 0) {
        params.append('tiers', filters.tiers.join(','));
      }
      if (filters.sort && filters.sort !== 'default') {
        params.append('sort', filters.sort);
      }
      if (filters.failureCategory) {
        params.append('failureCategory', filters.failureCategory);
      }
      if (filters.search) {
        params.append('search', filters.search);
      }
      if (filters.regressedOnly) {
        params.append('regressedOnly', 'true');
      }
      if (filters.regressedSince) {
        params.append('regressedSince', filters.regressedSince);
      }
      if (filters.resolvedSince) {
        params.append('resolvedSince', filters.resolvedSince);
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

  const { mutate: resetFlakinessMutation } = useMutation('/api/test', {
    method: 'POST',
    onSuccess: () => {
      invalidateCache(queryClient, { predicate: '/api/tests' });
      toast.success('Flakiness score reset — new flakiness will be tracked from now');
    },
  });

  const { mutate: clearFlakinessResetMutation } = useMutation('/api/test', {
    method: 'DELETE',
    onSuccess: () => {
      invalidateCache(queryClient, { predicate: '/api/tests' });
      toast.success('Flakiness reset removed — score recomputed over full window');
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

  const tests = useMemo(() => testsData?.pages.flatMap((page) => page.data) ?? [], [testsData]);

  const regressionFilterActive =
    !!filters.regressedOnly || !!filters.regressedSince || !!filters.resolvedSince;
  const regressionHighlightMode: 'opened' | 'closed' | null = filters.resolvedSince
    ? 'closed'
    : filters.regressedOnly || filters.regressedSince
      ? 'opened'
      : null;

  const totalTests = testsData?.pages[0]?.total ?? 0;

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
            <div className="rounded-md border overflow-x-auto">
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
                    <TestRow
                      key={`${item.testId}-${item.fileId}-${item.project}`}
                      item={item}
                      warningThreshold={warningThreshold}
                      quarantineThreshold={quarantineThreshold}
                      stale={isStale(item)}
                      regressionFilterActive={regressionFilterActive}
                      regressionHighlightMode={regressionHighlightMode}
                      onQuarantine={handleQuarantineAction}
                      onResetFlakiness={handleResetFlakiness}
                      onClearFlakinessReset={handleClearFlakinessReset}
                      onDelete={handleDeleteAction}
                    />
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
        <DialogContent onCloseAutoFocus={(e) => e.preventDefault()}>
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
        <DialogContent onCloseAutoFocus={(e) => e.preventDefault()}>
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

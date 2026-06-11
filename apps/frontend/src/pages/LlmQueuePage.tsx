import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Pagination,
  PaginationContent,
  PaginationFirst,
  PaginationItem,
  PaginationLast,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  type LlmUsageByModelRow,
  useLlmTaskModels,
  useLlmTaskStats,
  useLlmTasks,
  useLlmUsageByModel,
  useLlmUsageStats,
} from '@/hooks/useLlmTasks';
import useMutation from '@/hooks/useMutation';
import { formatCategoryName } from '@/lib/format';
import { invalidateCache } from '@/lib/query-cache';
import { formatRelativeTime } from '@/lib/time';
import { withBase } from '@/lib/url';

/** Short, single-word labels for the task-type filter and column. The DB
 *  stores `test_analysis` / `report_summary` / `project_summary`; these are
 *  noisy in a list view, so collapse them. */
const TYPE_SHORT_LABEL: Record<string, string> = {
  test_analysis: 'Test',
  report_summary: 'Report',
  project_summary: 'Project',
};

/** Build the URL to the served Playwright report with a deep-link to a test.
 *  Mirrors the hash format the Playwright report viewer parses. */
function buildServedTestUrl(reportId: string, testId?: string): string {
  const base = withBase(`/api/serve/${reportId}/index.html`);
  return testId ? `${base}#?testId=${encodeURIComponent(testId)}` : base;
}

function TaskTokensCell({
  input,
  output,
  status,
  prompt,
  result,
}: Readonly<{
  input?: number | null;
  output?: number | null;
  status?: string;
  prompt?: string | null;
  result?: string | null;
}>) {
  const inputVal = input ?? 0;
  const outputVal = output ?? 0;
  if (status === 'processing' && inputVal > 0) {
    return (
      <>
        <CopyableTokenCount display={`~${inputVal}`} text={prompt} label="Prompt" /> / -
      </>
    );
  }
  if (inputVal === 0 && outputVal === 0) return <>-</>;
  return (
    <>
      <CopyableTokenCount display={String(inputVal)} text={prompt} label="Prompt" />
      {' / '}
      <CopyableTokenCount display={String(outputVal)} text={result} label="Response" />
    </>
  );
}

/** Human-readable big-number formatter: 1234567 → "1.2M", 4567 → "4.6K". */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

interface CopyableTokenCountProps {
  display: string;
  text: string | null | undefined;
  label: string;
}

function CopyableTokenCount({ display, text, label }: Readonly<CopyableTokenCountProps>) {
  if (!text) {
    return <span title={`${label} not available`}>{display}</span>;
  }
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied (${text.length.toLocaleString()} chars)`);
    } catch (error) {
      toast.error(`Failed to copy: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Click to copy ${label.toLowerCase()}`}
      aria-label={`Copy ${label.toLowerCase()}`}
      className="cursor-pointer hover:underline focus-visible:underline focus-visible:outline-none"
    >
      {display}
    </button>
  );
}

const PAGE_SIZE = 25;

const STATUS_OPTIONS = ['all', 'queued', 'processing', 'completed', 'failed', 'cancelled'] as const;
const TYPE_OPTIONS = ['all', 'test_analysis', 'report_summary', 'project_summary'] as const;

function statusBadgeVariant(status: string) {
  switch (status) {
    case 'queued':
      return 'secondary';
    case 'processing':
      return 'running';
    case 'completed':
      return 'success';
    case 'failed':
      return 'failure';
    case 'cancelled':
      return 'skipped';
    default:
      return 'outline';
  }
}

function parseSqliteTs(ts: string): number {
  // SQLite's CURRENT_TIMESTAMP emits 'YYYY-MM-DD HH:MM:SS' (UTC, no zone marker).
  // V8 parses that as local time, which skews durations by the local UTC offset.
  // Treat zone-less timestamps as UTC by appending 'Z' before parsing.
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(ts)) {
    return new Date(`${ts.replace(' ', 'T')}Z`).getTime();
  }
  return new Date(ts).getTime();
}

function formatDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt || !completedAt) return '-';
  // Math.max guards against any remaining clock skew in legacy rows so the duration
  // is never displayed as negative — show 0 instead and let the user see the column.
  const ms = Math.max(0, parseSqliteTs(completedAt) - parseSqliteTs(startedAt));
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export default function LlmQueuePage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [modelFilter, setModelFilter] = useState<string>('all');
  const [modelDropdownOpened, setModelDropdownOpened] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Usage card period — 7d default, toggleable to 30d.
  const [usageDays, setUsageDays] = useState<7 | 30>(7);
  // "Check by model" expandable section — lazy-loads its data on first open.
  const [showByModel, setShowByModel] = useState(false);
  // Reset-counters confirmation dialog (POST /api/llm/usage/reset).
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const { data: stats, refetch: refetchStats } = useLlmTaskStats();
  const { data: usageData, refetch: refetchUsage } = useLlmUsageStats(usageDays);
  const usage = usageData?.data;
  const { data: tasksData, refetch: refetchTasks } = useLlmTasks({
    status: statusFilter === 'all' ? undefined : statusFilter,
    type: typeFilter === 'all' ? undefined : typeFilter,
    model: modelFilter === 'all' ? undefined : modelFilter,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const { data: modelsData } = useLlmTaskModels(modelDropdownOpened);

  const tasks = tasksData?.data ?? [];
  const total = tasksData?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      refetchStats();
      refetchTasks();
    }, 5000);
    return () => clearInterval(interval);
  }, [refetchStats, refetchTasks]);

  // Refresh usage stats less aggressively — period is in days, no need to poll fast.
  useEffect(() => {
    const interval = setInterval(() => refetchUsage(), 60_000);
    return () => clearInterval(interval);
  }, [refetchUsage]);

  const invalidateLlmQueries = useCallback(() => {
    invalidateCache(queryClient, { predicate: '/api/llm' });
  }, [queryClient]);

  // Mutations
  const clearQueueMutation = useMutation('/api/llm/tasks/clear', {
    method: 'DELETE',
    onSuccess: () => {
      toast.success('Queue cleared');
      invalidateLlmQueries();
    },
  });

  const generateExistingMutation = useMutation('/api/llm/generate-existing', {
    onSuccess: () => {
      toast.success('Generation started for existing reports');
      invalidateLlmQueries();
    },
  });

  const rerunAllMutation = useMutation('/api/llm/rerun-all', {
    onSuccess: () => {
      toast.success('Re-running all failed tasks');
      invalidateLlmQueries();
    },
  });

  const resetUsageMutation = useMutation('/api/llm/usage/reset', {
    onSuccess: () => {
      toast.success('Usage counters reset');
      refetchUsage();
      setShowResetDialog(false);
      setIsResetting(false);
    },
    onError: () => {
      setIsResetting(false);
    },
  });

  const cancelTaskMutation = useMutation('/api/llm/tasks', {
    method: 'POST',
    onSuccess: () => {
      toast.success('Task cancelled');
      invalidateLlmQueries();
    },
  });

  const retryTaskMutation = useMutation('/api/llm/tasks', {
    method: 'POST',
    onSuccess: () => {
      toast.success('Task queued for retry');
      invalidateLlmQueries();
    },
  });

  const deleteTaskMutation = useMutation('/api/llm/tasks', {
    method: 'DELETE',
    onSuccess: () => {
      toast.success('Task deleted');
      invalidateLlmQueries();
    },
  });

  const bulkDeleteMutation = useMutation('/api/llm/tasks', {
    method: 'DELETE',
    onSuccess: () => {
      toast.success('Selected tasks deleted');
      setSelectedIds(new Set());
      invalidateLlmQueries();
    },
  });

  const [isBulkCancelling, setIsBulkCancelling] = useState(false);

  const handleBulkCancel = useCallback(async () => {
    setIsBulkCancelling(true);
    try {
      const ids = Array.from(selectedIds);
      const jwtToken = typeof window !== 'undefined' ? localStorage.getItem('jwtToken') : null;
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (jwtToken) {
        headers.Authorization = `Bearer ${jwtToken}`;
      }
      for (const id of ids) {
        await fetch(`/api/llm/tasks/${id}/cancel`, {
          method: 'PATCH',
          headers,
        });
      }
      toast.success('Selected tasks cancelled');
      setSelectedIds(new Set());
      invalidateLlmQueries();
    } catch {
      toast.error('Failed to cancel some tasks');
    } finally {
      setIsBulkCancelling(false);
    }
  }, [selectedIds, invalidateLlmQueries]);

  // Selection handlers
  const allSelected = tasks.length > 0 && tasks.every((t) => selectedIds.has(t.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tasks.map((t) => t.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [statusFilter, typeFilter, modelFilter]);

  const statCards = useMemo(
    () => [
      { label: 'Queued', count: stats?.queued ?? 0, variant: 'secondary' as const },
      { label: 'Processing', count: stats?.processing ?? 0, variant: 'running' as const },
      { label: 'Completed', count: stats?.completed ?? 0, variant: 'success' as const },
      { label: 'Failed', count: stats?.failed ?? 0, variant: 'failure' as const },
      { label: 'Cancelled', count: stats?.cancelled ?? 0, variant: 'skipped' as const },
    ],
    [stats]
  );

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">LLM Queue</h1>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {statCards.map((s) => (
          <Card key={s.label} className="p-3">
            <CardHeader className="p-0 pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{s.count}</span>
                <Badge variant={s.variant} className="text-xs">
                  {s.label}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Usage Card — aggregated tokens + reuse rate over the selected period.
          Shown alongside the queue-status stat bar above so the user has both
          "what's happening right now" and "what did this cost" in one view. */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Usage</CardTitle>
            <span className="text-xs text-muted-foreground">
              completed tasks · last {usageDays}d
            </span>
          </div>
          <div className="flex gap-1 items-center">
            {([7, 30] as const).map((d) => (
              <Button
                key={d}
                size="sm"
                variant={usageDays === d ? 'default' : 'outline'}
                onClick={() => setUsageDays(d)}
              >
                {d}d
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowResetDialog(true)}
              title="Reset usage counters to zero"
            >
              Reset
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <div className="text-2xl font-bold">{formatCount(usage?.totals.tasks ?? 0)}</div>
            <div className="text-xs text-muted-foreground">tasks completed</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{formatCount(usage?.totals.inputTokens ?? 0)}</div>
            <div className="text-xs text-muted-foreground">input tokens</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{formatCount(usage?.totals.outputTokens ?? 0)}</div>
            <div className="text-xs text-muted-foreground">output tokens</div>
          </div>
          <div>
            <div className="text-2xl font-bold">
              {usage ? `${Math.round(usage.reuse.rate * 100)}%` : '—'}
            </div>
            <div
              className="text-xs text-muted-foreground"
              title={
                usage
                  ? `${usage.reuse.reused} of ${usage.reuse.analyses} analyses reused via signature match`
                  : ''
              }
            >
              reused (no LLM call)
            </div>
          </div>
        </div>

        {usage && usage.totals.tasks > 0 && (
          <div className="mt-4 pt-3 border-t border-border">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              {(['test_analysis', 'report_summary', 'project_summary'] as const).map((t) => {
                const row = usage.byType[t];
                if (!row) return null;
                return (
                  <span key={t} className="whitespace-nowrap">
                    <span className="font-medium">{TYPE_SHORT_LABEL[t]}:</span> {row.tasks}{' '}
                    {row.tasks === 1 ? 'task' : 'tasks'} · {formatCount(row.totalTokens)} tokens
                  </span>
                );
              })}
              <div className="ml-auto">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowByModel((v) => !v)}
                  aria-expanded={showByModel}
                >
                  {showByModel ? 'Hide by model' : 'Check by model'}
                </Button>
              </div>
            </div>
            {showByModel && <UsageByModelBreakdown days={usageDays} />}
          </div>
        )}
      </Card>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Status:</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Type:</span>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((t) => (
                <SelectItem key={t} value={t}>
                  {t === 'all' ? 'All' : (TYPE_SHORT_LABEL[t] ?? formatCategoryName(t))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Model:</span>
          <Select
            value={modelFilter}
            onValueChange={setModelFilter}
            onOpenChange={(open) => {
              if (open) setModelDropdownOpened(true);
            }}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {(modelsData?.models ?? []).map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
              {modelFilter !== 'all' && !(modelsData?.models ?? []).includes(modelFilter) && (
                <SelectItem value={modelFilter}>{modelFilter}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={generateExistingMutation.isPending}
            onClick={() => generateExistingMutation.mutate({})}
          >
            {generateExistingMutation.isPending ? 'Starting...' : 'Generate for Existing'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={rerunAllMutation.isPending}
            onClick={() => rerunAllMutation.mutate({})}
          >
            {rerunAllMutation.isPending ? 'Re-running...' : 'Re-run All Failed'}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={clearQueueMutation.isPending}
            onClick={() => {
              if (window.confirm('Clear all queued and failed tasks? This cannot be undone.')) {
                clearQueueMutation.mutate({});
              }
            }}
          >
            {clearQueueMutation.isPending ? 'Clearing...' : 'Clear Queue'}
          </Button>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Button
            variant="destructive"
            size="sm"
            disabled={bulkDeleteMutation.isPending}
            onClick={() =>
              bulkDeleteMutation.mutate({ body: { ids: Array.from(selectedIds) } as any })
            }
          >
            {bulkDeleteMutation.isPending ? 'Deleting...' : `Delete Selected (${selectedIds.size})`}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isBulkCancelling}
            onClick={handleBulkCancel}
          >
            {isBulkCancelling ? 'Cancelling...' : `Cancel Selected (${selectedIds.size})`}
          </Button>
        </div>
      )}

      {/* Task Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Report</TableHead>
              <TableHead>Test</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Tokens (in/out)</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Error</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                  No tasks found
                </TableCell>
              </TableRow>
            ) : (
              tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(task.id)}
                      onCheckedChange={() => toggleSelect(task.id)}
                      aria-label={`Select task ${task.id}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge variant={statusBadgeVariant(task.status)}>{task.status}</Badge>
                      {/* Reused-via-signature: completed test_analysis task whose reuse path
                          explicitly wrote {inputTokens: 0, outputTokens: 0}. We require
                          STRICT zero (not `?? 0`) so old rows with NULL tokens — captured
                          before token persistence existed — don't get a false-positive badge. */}
                      {task.status === 'completed' &&
                        task.type === 'test_analysis' &&
                        task.inputTokens === 0 &&
                        task.outputTokens === 0 && (
                          <Badge
                            variant="secondary"
                            className="text-xs"
                            title="Analysis was reused from a prior signature match — no LLM call was made."
                          >
                            ♻ Reused
                          </Badge>
                        )}
                      {/* Partial result during streaming: incremental persistence has flushed
                          some tokens but the stream hasn't completed yet. */}
                      {task.status === 'processing' && task.result && task.result.length > 0 && (
                        <Badge
                          variant="outline"
                          className="text-xs"
                          title="Streaming in progress — partial content is already persisted."
                        >
                          Streaming
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {TYPE_SHORT_LABEL[task.type] ?? formatCategoryName(task.type)}
                  </TableCell>
                  <TableCell>
                    {task.reportId ? (
                      <Link
                        to={`/report/${task.reportId}`}
                        className="text-sm text-primary hover:underline"
                        // Full reportId on hover so the UUID is still discoverable
                        // even though the cell shows the human-friendly displayNumber.
                        title={task.reportId}
                      >
                        {task.reportDisplayNumber != null
                          ? `#${task.reportDisplayNumber}`
                          : `${task.reportId.slice(0, 8)}...`}
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {task.testId && task.reportId ? (
                      // Link to the served Playwright report with a deep-link to this test.
                      // Opens in a new tab so the user keeps the queue page in place.
                      // Show the human-readable test title when we have it; fall back to
                      // the hashed testId for older rows or non-test task types. Full
                      // testId still discoverable via the link's title attribute.
                      <a
                        href={buildServedTestUrl(task.reportId, task.testId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline break-words whitespace-normal"
                        title={task.testId}
                      >
                        {task.testTitle ?? task.testId}
                      </a>
                    ) : task.testId ? (
                      <span className="text-sm break-words whitespace-normal" title={task.testId}>
                        {task.testTitle ?? task.testId}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm break-all whitespace-normal">
                    {task.model ?? <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="text-sm font-mono whitespace-nowrap">
                    <TaskTokensCell
                      input={task.inputTokens}
                      output={task.outputTokens}
                      status={task.status}
                      prompt={task.prompt}
                      result={task.result}
                    />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatRelativeTime(task.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatDuration(task.startedAt, task.completedAt)}
                  </TableCell>
                  <TableCell>
                    {task.status === 'failed' && task.error ? (
                      <span className="text-sm text-destructive cursor-help" title={task.error}>
                        {task.error.length > 40 ? `${task.error.slice(0, 40)}...` : task.error}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {task.status === 'queued' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={cancelTaskMutation.isPending}
                          onClick={() =>
                            cancelTaskMutation.mutate({
                              path: `/api/llm/tasks/${task.id}/cancel`,
                            })
                          }
                        >
                          Cancel
                        </Button>
                      )}
                      {task.status === 'failed' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={retryTaskMutation.isPending}
                          onClick={() =>
                            retryTaskMutation.mutate({
                              path: `/api/llm/tasks/${task.id}/retry`,
                            })
                          }
                        >
                          Retry
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={deleteTaskMutation.isPending}
                        onClick={() =>
                          deleteTaskMutation.mutate({
                            path: `/api/llm/tasks/${task.id}`,
                          })
                        }
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationFirst
                  onClick={() => page !== 1 && setPage(1)}
                  className={page === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => page > 1 && setPage(page - 1)}
                  className={page === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                />
              </PaginationItem>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }
                return (
                  <PaginationItem key={pageNum}>
                    <PaginationLink
                      onClick={() => setPage(pageNum)}
                      isActive={page === pageNum}
                      className="cursor-pointer"
                    >
                      {pageNum}
                    </PaginationLink>
                  </PaginationItem>
                );
              })}
              <PaginationItem>
                <PaginationNext
                  onClick={() => page < totalPages && setPage(page + 1)}
                  className={
                    page === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'
                  }
                />
              </PaginationItem>
              <PaginationItem>
                <PaginationLast
                  onClick={() => page !== totalPages && setPage(totalPages)}
                  className={
                    page === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'
                  }
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}

      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset usage counters?</DialogTitle>
            <DialogDescription>
              This sets the new baseline for the Usage card to right now. Historical task rows are
              kept in the database, but the chart will read as zero until new completed tasks land.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResetDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isResetting}
              onClick={() => {
                setIsResetting(true);
                resetUsageMutation.mutate({});
              }}
            >
              {isResetting ? 'Resetting…' : 'Reset counters'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Per-(baseUrl, model) usage table for the Usage card. Owns its own data
 *  fetch (gated by the parent's expanded state) so the always-visible card
 *  doesn't pay the query cost. Renders a skeleton on first open. */
function UsageByModelBreakdown({ days }: { days: number }) {
  const { data, isLoading, isError } = useLlmUsageByModel(days, true);
  const rows: LlmUsageByModelRow[] = data?.data.rows ?? [];

  if (isLoading) {
    return (
      <div className="mt-3 space-y-2" aria-live="polite" aria-busy="true">
        <div className="h-4 w-40 bg-muted animate-pulse rounded" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-8 w-full bg-muted/60 animate-pulse rounded" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mt-3 text-xs text-destructive">
        Failed to load per-model breakdown. Try collapsing and re-opening.
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="mt-3 text-xs text-muted-foreground">
        No completed tasks recorded for this period.
      </div>
    );
  }

  return (
    <div className="mt-3 rounded border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Base URL</TableHead>
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Tasks</TableHead>
            <TableHead className="text-right">Input</TableHead>
            <TableHead className="text-right">Output</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.baseUrl}|${r.model}`}>
              <TableCell className="text-xs font-mono break-all whitespace-normal">
                {r.baseUrl || <span className="text-muted-foreground">Unknown</span>}
              </TableCell>
              <TableCell className="text-xs font-mono break-all whitespace-normal">
                {r.model || <span className="text-muted-foreground">Unknown</span>}
              </TableCell>
              <TableCell className="text-xs text-right">{r.tasks}</TableCell>
              <TableCell className="text-xs font-mono text-right">
                {formatCount(r.inputTokens)}
              </TableCell>
              <TableCell className="text-xs font-mono text-right">
                {formatCount(r.outputTokens)}
              </TableCell>
              <TableCell className="text-xs font-mono text-right">
                {formatCount(r.totalTokens)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

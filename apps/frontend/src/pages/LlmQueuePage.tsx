import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useLlmTasks, useLlmTaskStats } from '@/hooks/useLlmTasks';
import useMutation from '@/hooks/useMutation';
import { formatCategoryName } from '@/lib/format';
import { invalidateCache } from '@/lib/query-cache';

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

function formatDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt || !completedAt) return '-';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export default function LlmQueuePage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: stats, refetch: refetchStats } = useLlmTaskStats();
  const { data: tasksData, refetch: refetchTasks } = useLlmTasks({
    status: statusFilter === 'all' ? undefined : statusFilter,
    type: typeFilter === 'all' ? undefined : typeFilter,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

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
    setPage(0);
    setSelectedIds(new Set());
  }, [statusFilter, typeFilter]);

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
    <div className="container mx-auto p-6 space-y-6">
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
                  {t === 'all' ? 'All' : formatCategoryName(t)}
                </SelectItem>
              ))}
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
            onClick={() => bulkDeleteMutation.mutate({ body: { ids: Array.from(selectedIds) } as any })}
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
              <TableHead>Created</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Error</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
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
                    <Badge variant={statusBadgeVariant(task.status)}>{task.status}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{formatCategoryName(task.type)}</TableCell>
                  <TableCell>
                    {task.reportId ? (
                      <Link
                        to={`/report/${task.reportId}`}
                        className="text-sm text-primary hover:underline"
                      >
                        {task.reportId.slice(0, 8)}...
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {task.testId ? (
                      <span className="text-sm font-mono" title={task.testId}>
                        {task.testId.length > 20
                          ? `${task.testId.slice(0, 20)}...`
                          : task.testId}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatRelativeTime(task.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatDuration(task.startedAt, task.completedAt)}
                  </TableCell>
                  <TableCell>
                    {task.status === 'failed' && task.error ? (
                      <span
                        className="text-sm text-destructive cursor-help"
                        title={task.error}
                      >
                        {task.error.length > 40
                          ? `${task.error.slice(0, 40)}...`
                          : task.error}
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
            Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

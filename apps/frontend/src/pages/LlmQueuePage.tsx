import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  PAGE_SIZE,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  TYPE_SHORT_LABEL,
} from '@/components/llm-queue/format-task';
import { TaskTable } from '@/components/llm-queue/TaskTable';
import { StatsBar, UsageCard } from '@/components/llm-queue/UsageCard';
import PaginatedControls from '@/components/paginated-controls';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLlmTaskModels, useLlmTaskStats, useLlmTasks } from '@/hooks/useLlmTasks';
import useMutation from '@/hooks/useMutation';
import { useSyncSearchParams } from '@/hooks/useSyncSearchParams';
import { authHeaders } from '@/lib/auth';
import { formatCategoryName } from '@/lib/format';
import { invalidateCache } from '@/lib/query-cache';

export default function LlmQueuePage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<string>(
    () => searchParams.get('status') ?? 'all'
  );
  const [typeFilter, setTypeFilter] = useState<string>(() => searchParams.get('type') ?? 'all');
  const [modelFilter, setModelFilter] = useState<string>(() => searchParams.get('model') ?? 'all');
  const [modelDropdownOpened, setModelDropdownOpened] = useState(false);
  const [page, setPage] = useState(() => {
    const raw = Number.parseInt(searchParams.get('page') ?? '1', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: stats } = useLlmTaskStats();
  const hasActiveWork = (stats?.queued ?? 0) + (stats?.processing ?? 0) > 0;
  const { data: tasksData } = useLlmTasks(
    {
      status: statusFilter === 'all' ? undefined : statusFilter,
      type: typeFilter === 'all' ? undefined : typeFilter,
      model: modelFilter === 'all' ? undefined : modelFilter,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    },
    { active: hasActiveWork }
  );
  const { data: modelsData } = useLlmTaskModels(modelDropdownOpened);

  const tasks = tasksData?.data ?? [];
  const total = tasksData?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const invalidateLlmQueries = useCallback(() => {
    invalidateCache(queryClient, { predicate: '/api/llm' });
  }, [queryClient]);

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
      const headers: HeadersInit = { 'Content-Type': 'application/json', ...authHeaders() };
      const results = await Promise.allSettled(
        ids.map((id) => fetch(`/api/llm/tasks/${id}/cancel`, { method: 'PATCH', headers }))
      );
      const failed = results.filter((r) => r.status === 'rejected' || !r.value.ok).length;
      if (failed > 0) {
        toast.error(`Failed to cancel ${failed} of ${ids.length} task(s)`);
      } else {
        toast.success('Selected tasks cancelled');
      }
      setSelectedIds(new Set());
      invalidateLlmQueries();
    } catch {
      toast.error('Failed to cancel some tasks');
    } finally {
      setIsBulkCancelling(false);
    }
  }, [selectedIds, invalidateLlmQueries]);

  const allSelected = tasks.length > 0 && tasks.every((t) => selectedIds.has(t.id));

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tasks.map((t) => t.id)));
    }
  }, [allSelected, tasks]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger-only deps
  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [statusFilter, typeFilter, modelFilter]);

  useSyncSearchParams({
    status: statusFilter !== 'all' ? statusFilter : null,
    type: typeFilter !== 'all' ? typeFilter : null,
    model: modelFilter !== 'all' ? modelFilter : null,
    page: page > 1 ? String(page) : null,
  });

  return (
    <div className="space-y-6">
      <StatsBar stats={stats} />

      <UsageCard />

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
              bulkDeleteMutation.mutate({
                body: { ids: Array.from(selectedIds) } as Record<string, unknown>,
              })
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

      <TaskTable
        tasks={tasks}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        allSelected={allSelected}
        onInvalidate={invalidateLlmQueries}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <PaginatedControls
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            className="mx-0 w-auto"
          />
        </div>
      )}
    </div>
  );
}

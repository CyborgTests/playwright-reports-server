import type { LlmTask } from '@playwright-reports/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLlmModels } from '@/hooks/useLlmModels';
import { useLlmEstimates } from '@/hooks/useLlmTasks';
import useMutation from '@/hooks/useMutation';
import { buildRateMap } from './format-task';
import { TaskRow, TOTAL_COLUMNS } from './TaskRow';

export function TaskTable({
  tasks,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  allSelected,
  onInvalidate,
}: Readonly<{
  tasks: LlmTask[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  allSelected: boolean;
  onInvalidate: () => void;
}>) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childrenById, setChildrenById] = useState<Record<string, LlmTask[] | 'loading'>>({});

  const { data: models } = useLlmModels();
  const rates = useMemo(() => buildRateMap(models ?? []), [models]);
  const { data: estimatesData } = useLlmEstimates();
  const estimates = estimatesData?.data;

  const { mutateAsync: fetchRoles } = useMutation<{ data?: LlmTask[] }>('/api/llm/tasks', {
    method: 'GET',
    silent: true,
  });

  const fetchChildren = useCallback(
    async (id: string) => {
      try {
        const json = await fetchRoles({ path: `/api/llm/tasks/${id}/roles` });
        setChildrenById((p) => ({ ...p, [id]: json.data ?? [] }));
      } catch {
        setChildrenById((p) => ({ ...p, [id]: p[id] && p[id] !== 'loading' ? p[id] : [] }));
      }
    },
    [fetchRoles]
  );

  const toggleExpand = useCallback(
    (id: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setChildrenById((prev) => {
        if (prev[id]) return prev;
        void fetchChildren(id);
        return { ...prev, [id]: 'loading' };
      });
    },
    [fetchChildren]
  );

  const prevStatus = useRef<Record<string, string>>({});
  useEffect(() => {
    const liveIds: string[] = [];
    const seen = new Set<string>();
    for (const t of tasks) {
      seen.add(t.id);
      if (!expanded.has(t.id)) continue;
      const prior = prevStatus.current[t.id];
      if (prior && prior !== t.status) void fetchChildren(t.id);
      prevStatus.current[t.id] = t.status;
      if (t.status === 'processing') liveIds.push(t.id);
    }
    for (const id of Object.keys(prevStatus.current)) {
      if (!seen.has(id)) delete prevStatus.current[id];
    }
    if (liveIds.length === 0) return;
    const interval = setInterval(() => {
      for (const id of liveIds) void fetchChildren(id);
    }, 2500);
    return () => clearInterval(interval);
  }, [tasks, expanded, fetchChildren]);

  const cancelTaskMutation = useMutation('/api/llm/tasks', {
    method: 'POST',
    onSuccess: () => {
      toast.success('Task cancelled');
      onInvalidate();
    },
  });

  const retryTaskMutation = useMutation('/api/llm/tasks', {
    method: 'POST',
    onSuccess: () => {
      toast.success('Task queued for retry');
      onInvalidate();
    },
  });

  const deleteTaskMutation = useMutation('/api/llm/tasks', {
    method: 'DELETE',
    onSuccess: () => {
      toast.success('Task deleted');
      onInvalidate();
    },
  });

  const { mutate: cancelMutate } = cancelTaskMutation;
  const { mutate: retryMutate } = retryTaskMutation;
  const { mutate: deleteMutate } = deleteTaskMutation;

  const handleCancel = useCallback(
    (id: string) => cancelMutate({ path: `/api/llm/tasks/${id}/cancel` }),
    [cancelMutate]
  );
  const handleRetry = useCallback(
    (id: string) => retryMutate({ path: `/api/llm/tasks/${id}/retry` }),
    [retryMutate]
  );
  const handleDelete = useCallback(
    (id: string) => deleteMutate({ path: `/api/llm/tasks/${id}` }),
    [deleteMutate]
  );

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected}
                onCheckedChange={onToggleSelectAll}
                aria-label="Select all"
              />
            </TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Report</TableHead>
            <TableHead>Test</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Tokens (in/out)</TableHead>
            <TableHead>Cost</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Error</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.length === 0 ? (
            <TableRow>
              <TableCell colSpan={TOTAL_COLUMNS} className="text-center text-muted-foreground py-8">
                No tasks found
              </TableCell>
            </TableRow>
          ) : (
            tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                isSelected={selectedIds.has(task.id)}
                onToggleSelect={onToggleSelect}
                onCancel={handleCancel}
                onRetry={handleRetry}
                onDelete={handleDelete}
                cancelPending={cancelTaskMutation.isPending}
                retryPending={retryTaskMutation.isPending}
                deletePending={deleteTaskMutation.isPending}
                rates={rates}
                estimates={estimates}
                expanded={expanded.has(task.id)}
                childRows={childrenById[task.id]}
                onToggleExpand={toggleExpand}
              />
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

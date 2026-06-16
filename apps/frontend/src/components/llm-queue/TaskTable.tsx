import type { LlmTask } from '@playwright-reports/shared';
import { formatRelativeTime } from '@playwright-reports/shared';
import { memo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import useMutation from '@/hooks/useMutation';
import { formatCategoryName } from '@/lib/format';
import {
  buildServedTestUrl,
  formatDuration,
  statusBadgeVariant,
  TYPE_SHORT_LABEL,
} from './format-task';

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

interface TaskRowProps {
  task: LlmTask;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
  cancelPending: boolean;
  retryPending: boolean;
  deletePending: boolean;
}

const TaskRow = memo(function TaskRow({
  task,
  isSelected,
  onToggleSelect,
  onCancel,
  onRetry,
  onDelete,
  cancelPending,
  retryPending,
  deletePending,
}: TaskRowProps) {
  const handleSelect = useCallback(() => onToggleSelect(task.id), [task.id, onToggleSelect]);
  const handleCancel = useCallback(() => onCancel(task.id), [task.id, onCancel]);
  const handleRetry = useCallback(() => onRetry(task.id), [task.id, onRetry]);
  const handleDelete = useCallback(() => onDelete(task.id), [task.id, onDelete]);

  return (
    <TableRow>
      <TableCell>
        <Checkbox
          checked={isSelected}
          onCheckedChange={handleSelect}
          aria-label={`Select task ${task.id}`}
        />
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          <Badge variant={statusBadgeVariant(task.status)}>{task.status}</Badge>
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
      <TableCell className="text-sm">{formatDuration(task.startedAt, task.completedAt)}</TableCell>
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
            <Button variant="ghost" size="sm" disabled={cancelPending} onClick={handleCancel}>
              Cancel
            </Button>
          )}
          {task.status === 'failed' && (
            <Button variant="ghost" size="sm" disabled={retryPending} onClick={handleRetry}>
              Retry
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={deletePending}
            onClick={handleDelete}
          >
            Delete
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
});

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
              />
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}

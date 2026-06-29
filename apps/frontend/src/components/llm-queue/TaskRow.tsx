import type { LlmEstimates, LlmTask } from '@playwright-reports/shared';
import {
  formatRelativeTime,
  parentEstimateKey,
  roleEstimateKey,
  strategyEstimateKey,
} from '@playwright-reports/shared';
import { memo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell, TableRow } from '@/components/ui/table';
import { formatCategoryName } from '@/lib/format';
import {
  buildServedTestUrl,
  computeCost,
  formatCost,
  formatDuration,
  isMultiRoleStrategy,
  type ModelRate,
  ROLE_LABEL,
  STRATEGY_LABEL,
  statusBadgeVariant,
  TYPE_SHORT_LABEL,
} from './format-task';
import { TaskProgress } from './TaskProgress';

export const TOTAL_COLUMNS = 12;

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

function parseVerdict(result?: string | null): { score?: number; count?: number } | null {
  if (!result) return null;
  const fence = result.match(/```(?:json)?\s*([\s\S]*?)```/i);
  for (const c of [fence?.[1], result]) {
    if (!c) continue;
    try {
      const parsed = JSON.parse(c.trim());
      if (Array.isArray(parsed)) return { count: parsed.length };
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.score === 'number') return { score: parsed.score };
        if (Array.isArray(parsed.verdicts)) return { count: parsed.verdicts.length };
        if (Array.isArray(parsed.results)) return { count: parsed.results.length };
      }
    } catch {
      // not JSON in this candidate - try the next
    }
  }
  return null;
}

function VerdictSummary({
  role,
  result,
}: Readonly<{ role?: string | null; result?: string | null }>) {
  const verdict = parseVerdict(result);
  if (!verdict) return null;
  const display =
    verdict.score != null
      ? `score ${verdict.score.toFixed(2)}`
      : `${verdict.count} verdict${verdict.count === 1 ? '' : 's'}`;
  return <CopyableTokenCount display={display} text={result} label={`${role ?? 'Role'} output`} />;
}

function RolePanel({
  rows,
  rates,
  strategy,
  estimates,
}: Readonly<{
  rows: LlmTask[] | 'loading' | undefined;
  rates: Map<string, ModelRate>;
  strategy?: string | null;
  estimates?: LlmEstimates;
}>) {
  if (rows === 'loading' || rows === undefined) {
    return <div className="px-12 py-3 text-xs text-muted-foreground">Loading roles…</div>;
  }
  if (rows.length === 0) {
    return (
      <div className="px-12 py-3 text-xs text-muted-foreground">No role executions recorded.</div>
    );
  }
  let total = 0;
  let anyCost = false;
  const pending = rows.filter((c) => c.status === 'queued').length;
  const running = rows.filter((c) => c.status === 'processing').length;
  const done = rows.filter((c) => c.status === 'completed').length;
  const failed = rows.filter((c) => c.status === 'failed').length;
  return (
    <div className="px-6 py-3 space-y-2 text-sm">
      {(running > 0 || pending > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Live</span>
          {running > 0 && <span>{running} running</span>}
          {pending > 0 && <span>· {pending} queued</span>}
          {done > 0 && <span>· {done} done</span>}
          {failed > 0 && <span className="text-destructive">· {failed} failed</span>}
        </div>
      )}
      {rows.map((c, i) => {
        const isDone = c.status === 'completed';
        const cost = isDone
          ? computeCost(c.inputTokens, c.outputTokens, c.baseUrl, c.model, rates)
          : null;
        if (cost != null) {
          total += cost;
          anyCost = true;
        }
        return (
          <div key={c.id} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-3">
              <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <Badge variant="outline" className="w-24 shrink-0 justify-center font-normal">
                {ROLE_LABEL[c.role ?? ''] ?? c.role ?? 'role'}
              </Badge>
              <Badge variant={statusBadgeVariant(c.status)} className="shrink-0">
                {c.status}
              </Badge>
              <span className="min-w-0 flex-1 break-all font-mono">{c.model ?? '-'}</span>
              {c.role === 'screenshot_parser' && c.category && (
                <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                  {c.category}
                </span>
              )}
              {isDone && (
                <span className="shrink-0 whitespace-nowrap font-mono text-muted-foreground">
                  <VerdictSummary role={c.role} result={c.result} />
                </span>
              )}
              <span className="shrink-0 whitespace-nowrap font-mono text-muted-foreground">
                {isDone
                  ? `${(c.inputTokens ?? 0).toLocaleString()} / ${(c.outputTokens ?? 0).toLocaleString()} tok`
                  : '-'}
              </span>
              <span className="w-20 shrink-0 whitespace-nowrap text-right font-mono text-muted-foreground">
                {c.status === 'processing' ? (
                  <TaskProgress
                    startedAt={c.startedAt}
                    estimate={
                      estimates?.roles[
                        roleEstimateKey(c.type, strategy, c.role, c.model, c.baseUrl)
                      ]
                    }
                  />
                ) : (
                  formatDuration(c.startedAt, c.completedAt)
                )}
              </span>
              <span className="w-20 shrink-0 whitespace-nowrap text-right font-mono">
                {isDone ? formatCost(cost) : '-'}
              </span>
            </div>
            {c.error && (
              <span className="pl-8 text-xs text-destructive break-words" title={c.error}>
                {c.error}
              </span>
            )}
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-2 font-medium">
        <span className="text-muted-foreground">
          {rows.length} role call{rows.length === 1 ? '' : 's'} · total
        </span>
        <span className="w-20 text-right font-mono">{anyCost ? formatCost(total) : '-'}</span>
      </div>
    </div>
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
  rates: Map<string, ModelRate>;
  estimates?: LlmEstimates;
  expanded: boolean;
  childRows: LlmTask[] | 'loading' | undefined;
  onToggleExpand: (id: string) => void;
}

export const TaskRow = memo(function TaskRow({
  task,
  isSelected,
  onToggleSelect,
  onCancel,
  onRetry,
  onDelete,
  cancelPending,
  retryPending,
  deletePending,
  rates,
  estimates,
  expanded,
  childRows,
  onToggleExpand,
}: TaskRowProps) {
  const handleSelect = useCallback(() => onToggleSelect(task.id), [task.id, onToggleSelect]);
  const handleCancel = useCallback(() => onCancel(task.id), [task.id, onCancel]);
  const handleRetry = useCallback(() => onRetry(task.id), [task.id, onRetry]);
  const handleDelete = useCallback(() => onDelete(task.id), [task.id, onDelete]);
  const handleExpand = useCallback(() => onToggleExpand(task.id), [task.id, onToggleExpand]);

  const multi = isMultiRoleStrategy(task.strategy);
  const childSource = Array.isArray(childRows) ? childRows : task.childUsage;
  const childCostRows = childSource?.filter((c) => !('status' in c) || c.status === 'completed');
  const hasRoles =
    (Array.isArray(childRows) && childRows.length > 0) ||
    (task.childCount ?? 0) > 0 ||
    (task.childUsage?.length ?? 0) > 0;
  const expandable = multi || hasRoles;

  const childCost = childCostRows?.reduce(
    (s, c) => s + (computeCost(c.inputTokens, c.outputTokens, c.baseUrl, c.model, rates) ?? 0),
    0
  );
  const childCostKnown = !!childCostRows?.some(
    (c) => computeCost(c.inputTokens, c.outputTokens, c.baseUrl, c.model, rates) != null
  );

  const ownCost = multi
    ? null
    : computeCost(task.inputTokens, task.outputTokens, task.baseUrl, task.model, rates);
  const parentCost = multi
    ? childCostRows
      ? (childCost ?? 0)
      : null
    : (ownCost ?? 0) + (childCost ?? 0);
  const parentCostKnown = multi ? childCostKnown : ownCost != null || childCostKnown;

  return (
    <>
      <TableRow>
        <TableCell>
          <Checkbox
            checked={isSelected}
            onCheckedChange={handleSelect}
            aria-label={`Select task ${task.id}`}
          />
        </TableCell>
        <TableCell>
          <div className="flex flex-col gap-1 items-start">
            <Badge variant={statusBadgeVariant(task.status)}>{task.status}</Badge>
            {expandable && (
              <button
                type="button"
                onClick={handleExpand}
                aria-expanded={expanded}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
                title="Show per-role breakdown"
              >
                <span className="tabular-nums">{expanded ? '▾' : '▸'}</span>
                {multi ? (STRATEGY_LABEL[task.strategy ?? ''] ?? task.strategy) : 'Roles'}
              </button>
            )}
            {task.status === 'completed' &&
              task.type === 'test_analysis' &&
              task.inputTokens === 0 &&
              task.outputTokens === 0 &&
              !multi && (
                <Badge
                  variant="secondary"
                  className="text-xs"
                  title="Analysis was reused from a prior signature match - no LLM call was made."
                >
                  ♻ Reused
                </Badge>
              )}
            {task.status === 'processing' && task.result && task.result.length > 0 && (
              <Badge
                variant="outline"
                className="text-xs"
                title="Streaming in progress - partial content is already persisted."
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
          {multi ? (
            <span className="text-muted-foreground" title="Per-role models - expand for details">
              {Array.isArray(childRows)
                ? `${childRows.length} models`
                : task.childCount != null
                  ? `${task.childCount} models`
                  : 'multiple'}
            </span>
          ) : (
            (task.model ?? <span className="text-muted-foreground">-</span>)
          )}
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
        <TableCell className="text-sm font-mono whitespace-nowrap">
          {parentCostKnown ? (
            formatCost(parentCost)
          ) : multi && !childSource ? (
            <button
              type="button"
              onClick={handleExpand}
              className="text-muted-foreground hover:underline"
            >
              expand
            </button>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {formatRelativeTime(task.createdAt)}
        </TableCell>
        <TableCell className="text-sm">
          {task.status === 'processing' ? (
            <TaskProgress
              startedAt={task.startedAt}
              estimate={
                multi
                  ? estimates?.parentsByStrategy[strategyEstimateKey(task.type, task.strategy)]
                  : estimates?.parents[
                      parentEstimateKey(task.type, task.strategy, task.model, task.baseUrl)
                    ]
              }
            />
          ) : (
            formatDuration(task.startedAt, task.completedAt)
          )}
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
            {(task.status === 'queued' || task.status === 'processing') && (
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
      {expandable && expanded && (
        <TableRow>
          <TableCell colSpan={TOTAL_COLUMNS} className="bg-muted/30 p-0">
            <RolePanel
              rows={childRows}
              rates={rates}
              strategy={task.strategy}
              estimates={estimates}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
});

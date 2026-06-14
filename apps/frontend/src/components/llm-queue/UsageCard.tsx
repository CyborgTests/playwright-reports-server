import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { type LlmUsageByModelRow, useLlmUsageByModel, useLlmUsageStats } from '@/hooks/useLlmTasks';
import useMutation from '@/hooks/useMutation';
import { formatCount, TYPE_SHORT_LABEL } from './format-task';

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

interface LlmTaskStats {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export function StatsBar({ stats }: Readonly<{ stats: LlmTaskStats | undefined }>) {
  const statCards = [
    { label: 'Queued', count: stats?.queued ?? 0, variant: 'secondary' as const },
    { label: 'Processing', count: stats?.processing ?? 0, variant: 'running' as const },
    { label: 'Completed', count: stats?.completed ?? 0, variant: 'success' as const },
    { label: 'Failed', count: stats?.failed ?? 0, variant: 'failure' as const },
    { label: 'Cancelled', count: stats?.cancelled ?? 0, variant: 'skipped' as const },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
      {statCards.map((s) => (
        <Card key={s.label} className="p-3">
          <CardContent className="p-0">
            <div className="flex items-center gap-2">
              <Badge variant={s.variant} className="text-xs">
                {s.label}
              </Badge>
              <span className="text-2xl font-bold">{s.count}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function UsageCard({ usageDays: initialDays }: Readonly<{ usageDays?: 7 | 30 }>) {
  const [usageDays, setUsageDays] = useState<7 | 30>(initialDays ?? 7);
  const [showByModel, setShowByModel] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const { data: usageData, refetch: refetchUsage } = useLlmUsageStats(usageDays);
  const usage = usageData?.data;

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

  return (
    <>
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
    </>
  );
}

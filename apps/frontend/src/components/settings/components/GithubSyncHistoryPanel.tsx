import {
  formatDuration,
  type GithubSyncFailedArtifact,
  type GithubSyncRun,
  type GithubSyncRunStatus,
  type PaginationResponse,
} from '@playwright-reports/shared';
import { keepPreviousData } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import FormattedDate from '@/components/date-format';
import PaginatedControls from '@/components/paginated-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import useQuery from '@/hooks/useQuery';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 25;

export const SYNC_RUNS_KEY = 'github-sync-runs';
export const SYNC_FAILURES_KEY = 'github-sync-failures';

const RUN_BADGE: Record<
  GithubSyncRunStatus,
  { variant: 'success' | 'warning' | 'destructive' | 'secondary' | 'info'; label: string }
> = {
  running: { variant: 'info', label: 'Running' },
  success: { variant: 'success', label: 'Success' },
  partial: { variant: 'warning', label: 'Partial' },
  failed: { variant: 'destructive', label: 'Failed' },
  cancelled: { variant: 'secondary', label: 'Cancelled' },
};

function durationOf(run: GithubSyncRun): string {
  if (!run.finishedAt) return '-';
  return formatDuration(Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt)));
}

function retryStateText(failure: GithubSyncFailedArtifact): string {
  if (failure.abandonedReason === 'expired') return 'Expired on GitHub - skipped for good';
  return `Retrying every sync · ${failure.attempts} attempt(s) so far`;
}

export function FailedArtifactsBlock({
  configId,
  pendingArtifacts,
  abandonedArtifacts,
  onRetry,
  retrying,
  canRetry,
}: Readonly<{
  configId: string;
  pendingArtifacts: number;
  abandonedArtifacts: number;
  onRetry: () => void;
  retrying: boolean;
  canRetry: boolean;
}>) {
  const missingArtifacts = pendingArtifacts + abandonedArtifacts;
  const { data } = useQuery<GithubSyncFailedArtifact[]>(
    `/api/config/github-sync/${configId}/failures`,
    {
      queryKey: [SYNC_FAILURES_KEY, configId],
      enabled: missingArtifacts > 0,
      staleTime: 15_000,
    }
  );

  if (missingArtifacts === 0 || !data || data.length === 0) return null;

  const tone = pendingArtifacts > 0 ? 'destructive' : 'warning';

  return (
    <div
      className={cn(
        'mt-2 rounded-md border p-2',
        tone === 'destructive'
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-warning/40 bg-warning-50'
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span
          className={cn(
            'text-xs font-medium',
            tone === 'destructive' ? 'text-destructive' : 'text-warning-900'
          )}
        >
          {pendingArtifacts === 0
            ? `${missingArtifacts} artifact(s) expired on GitHub, no longer retried`
            : `${pendingArtifacts} artifact(s) missing${
                missingArtifacts > pendingArtifacts
                  ? `, ${missingArtifacts - pendingArtifacts} expired for good`
                  : ''
              }`}
        </span>
        {canRetry && pendingArtifacts > 0 && (
          <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
            Retry now
          </Button>
        )}
      </div>
      <div className="space-y-1">
        {data.map((failure) => (
          <div key={failure.artifactId} className="text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono">{failure.artifactName}</span>
              <span className="text-muted-foreground">
                run <span className="font-mono">{failure.runId}</span>
                {failure.runDate ? ` · ${failure.runDate}` : ''} · {failure.phase} ·{' '}
                {retryStateText(failure)} · last tried{' '}
                <FormattedDate date={failure.lastAttemptAt} />
              </span>
            </div>
            {failure.lastError && (
              <div
                className="line-clamp-1 break-all font-mono text-[10px] text-muted-foreground"
                title={failure.lastError}
              >
                {failure.lastError}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SyncHistory({ configId }: Readonly<{ configId: string }>) {
  const [collapsed, setCollapsed] = useState(true);
  const [page, setPage] = useState(1);
  const [showAll, setShowAll] = useState(false);

  const { data, isLoading, isError } = useQuery<PaginationResponse<GithubSyncRun>>(
    `/api/config/github-sync/${configId}/runs?page=${page}&limit=${PAGE_SIZE}&includeEmpty=${showAll}`,
    {
      queryKey: [SYNC_RUNS_KEY, configId, page, showAll],
      enabled: !collapsed,
      staleTime: 30_000,
      placeholderData: keepPreviousData,
    }
  );

  const runs = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          Sync history
        </button>
        {!collapsed && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(event) => {
                setShowAll(event.target.checked);
                setPage(1);
              }}
            />
            Include runs that found nothing
          </label>
        )}
      </div>

      {!collapsed && (
        <div className="mt-2 space-y-1.5">
          {isLoading ? (
            <>
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </>
          ) : isError ? (
            <p className="py-2 text-xs italic text-destructive">Could not load sync history.</p>
          ) : runs.length === 0 ? (
            <p className="py-2 text-xs italic text-muted-foreground">
              {showAll
                ? 'No sync runs recorded yet.'
                : 'No runs with uploads or failures - tick the box above to see every run.'}
            </p>
          ) : (
            runs.map((run) => {
              const badge = RUN_BADGE[run.status];
              return (
                <div
                  key={run.id}
                  className="grid grid-cols-[auto_1fr_auto] items-start gap-2 rounded border bg-card px-2 py-1.5 text-xs"
                >
                  <Badge variant={badge.variant} className="text-[10px]">
                    {badge.label}
                  </Badge>
                  <div className="min-w-0">
                    <span className="text-muted-foreground">
                      {run.trigger} · {run?.message} · {durationOf(run)}
                    </span>
                  </div>
                  <span className="whitespace-nowrap text-muted-foreground">
                    <FormattedDate date={run.startedAt} />
                  </span>
                </div>
              );
            })
          )}

          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
              <span>{pagination.total} runs</span>
              <PaginatedControls
                page={pagination.page}
                totalPages={pagination.totalPages}
                onPageChange={setPage}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

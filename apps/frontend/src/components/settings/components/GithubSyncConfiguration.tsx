import {
  CAPABILITIES,
  formatBytes,
  type GithubSyncConfig,
  type GithubSyncStatus,
  type SyncPhase,
  type SyncProgress,
  type SyncTransfer,
} from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Github } from 'lucide-react';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import FormattedDate from '@/components/date-format';
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
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/hooks/useAuth';
import { useHasCapability } from '@/hooks/useHasCapability';
import useMutation from '@/hooks/useMutation';
import useQuery from '@/hooks/useQuery';
import { useServerEvents } from '@/hooks/useServerEvents';
import { cn } from '@/lib/utils';
import { GithubSyncFormDialog } from './GithubSyncFormDialog';
import {
  FailedArtifactsBlock,
  SYNC_FAILURES_KEY,
  SYNC_RUNS_KEY,
  SyncHistory,
} from './GithubSyncHistoryPanel';

type GithubSyncConfigWithStatus = GithubSyncConfig & { status?: GithubSyncStatus };

const LIST_PATH = '/api/config/github-sync';

const SYNC_STEPS: { key: SyncPhase; label: string }[] = [
  { key: 'scanning', label: 'Scan workflows' },
  { key: 'downloading', label: 'Download from GitHub' },
  { key: 'uploading', label: 'Upload to app' },
];

type StepState = 'pending' | 'active' | 'done';

function stepStates(progress: SyncProgress): Record<SyncPhase, StepState> {
  const scanning = progress.phase === 'scanning';
  const uploadingStarted = progress.uploaded + progress.failed > 0 || !!progress.upload;
  return {
    scanning: scanning ? 'active' : 'done',
    downloading: progress.download ? 'active' : scanning ? 'pending' : 'done',
    uploading: progress.upload ? 'active' : !scanning && uploadingStarted ? 'done' : 'pending',
  };
}

function SyncStepper({ progress }: { progress: SyncProgress }) {
  const states = stepStates(progress);
  return (
    <div className="flex items-center gap-1 text-[11px] leading-none">
      {SYNC_STEPS.map((step, i) => {
        const state = states[step.key];
        return (
          <Fragment key={step.key}>
            {i > 0 && <span className="text-muted-foreground/40">›</span>}
            <span
              className={cn(
                'flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors',
                state === 'active' && 'bg-primary/10 font-medium text-primary',
                state === 'done' && 'text-muted-foreground',
                state === 'pending' && 'text-muted-foreground/50'
              )}
            >
              <span
                className={cn(
                  'flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[9px] tabular-nums',
                  state === 'active' && 'border-primary text-primary',
                  state === 'done' && 'border-transparent bg-muted-foreground/20',
                  state === 'pending' && 'border-muted-foreground/30'
                )}
              >
                {state === 'done' ? '✓' : i + 1}
              </span>
              {step.label}
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

function TransferRow({
  transfer,
  unit,
  arrow,
}: {
  transfer: SyncTransfer;
  unit: 'bytes' | 'files';
  arrow: '↓' | '↑';
}) {
  const pct =
    transfer.total > 0
      ? Math.min(100, Math.round((transfer.done / transfer.total) * 100))
      : undefined;
  const amount =
    unit === 'bytes'
      ? formatBytes(transfer.done) + (transfer.total ? ` / ${formatBytes(transfer.total)}` : '')
      : `${transfer.done}${transfer.total ? `/${transfer.total}` : ''} file${transfer.total === 1 ? '' : 's'}`;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground font-mono">
        <span className="truncate" title={transfer.artifact}>
          {arrow} {transfer.artifact}
        </span>
        <span className="shrink-0 tabular-nums">
          {amount}
          {pct !== undefined ? ` · ${pct}%` : ''}
        </span>
      </div>
      <Progress value={pct} className={cn('h-1', pct === undefined && 'animate-pulse')} />
    </div>
  );
}

function SyncProgressPanel({ progress }: { progress: SyncProgress }) {
  const scanning = progress.phase === 'scanning';
  const pct =
    progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0;
  const counters = (
    <span className="text-muted-foreground tabular-nums">
      ✓ {progress.uploaded}
      {progress.failed > 0 ? ` · ✕ ${progress.failed}` : ''}
      {progress.skipped > 0 ? ` · skipped ${progress.skipped}` : ''}
    </span>
  );

  return (
    <div className="rounded-md border bg-muted/30 p-2 space-y-2">
      <SyncStepper progress={progress} />
      <div className="flex items-center justify-between text-xs">
        {scanning ? (
          <span className="font-medium">
            Scanning workflow runs… {progress.total} artifact{progress.total === 1 ? '' : 's'} found
          </span>
        ) : (
          <span className="font-medium tabular-nums">
            [{progress.current}/{progress.total}] {pct}%
          </span>
        )}
        {counters}
      </div>
      <Progress
        value={scanning ? undefined : pct}
        className={cn('h-1.5', scanning && 'animate-pulse')}
      />
      {progress.download && <TransferRow transfer={progress.download} unit="bytes" arrow="↓" />}
      {progress.upload && <TransferRow transfer={progress.upload} unit="files" arrow="↑" />}
    </div>
  );
}

function statusBadge(cfg: GithubSyncConfigWithStatus) {
  if (cfg.status?.isRunning) {
    return <Badge variant="info">Running</Badge>;
  }
  if (!cfg.enabled) {
    return <Badge variant="secondary">Paused</Badge>;
  }
  const pending = cfg.status?.pendingArtifacts ?? 0;
  const abandoned = cfg.status?.abandonedArtifacts ?? 0;
  if (pending > 0) {
    return <Badge variant="destructive">{pending + abandoned} artifact(s) missing</Badge>;
  }
  if (abandoned > 0) {
    return <Badge variant="warning">{abandoned} artifact(s) unrecoverable</Badge>;
  }
  const last = cfg.status?.lastRun?.status;
  if (last === 'failed') return <Badge variant="destructive">Last run failed</Badge>;
  if (last === 'partial') return <Badge variant="warning">Last run partial</Badge>;
  if (last === 'cancelled') return <Badge variant="secondary">Cancelled</Badge>;
  if (last === 'success') return <Badge variant="success">OK</Badge>;
  return <Badge variant="outline">Idle</Badge>;
}

export default function GithubSyncConfiguration() {
  const session = useAuth();
  const hasCapability = useHasCapability();
  const canEditSync = hasCapability(CAPABILITIES.configGithubSync);
  const canRunSync = hasCapability(CAPABILITIES.runGithubSync);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<GithubSyncConfigWithStatus[]>(LIST_PATH, {
    staleTime: 10_000,
  });
  const configs = data ?? [];

  const invalidateConfigs = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [LIST_PATH] });
  }, [queryClient]);

  const invalidate = useCallback(() => {
    invalidateConfigs();
    queryClient.invalidateQueries({ queryKey: [SYNC_RUNS_KEY] });
    queryClient.invalidateQueries({ queryKey: [SYNC_FAILURES_KEY] });
  }, [invalidateConfigs, queryClient]);

  useServerEvents('/api/config/github-sync/events', invalidateConfigs, {
    enabled: session.status === 'authenticated',
  });

  const anyRunning = configs.some((cfg) => cfg.status?.isRunning);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !anyRunning) invalidate();
    wasRunning.current = anyRunning;
  }, [anyRunning, invalidate]);

  const [formOpen, setFormOpen] = useState(false);
  const [formConfig, setFormConfig] = useState<GithubSyncConfig | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GithubSyncConfig | null>(null);
  const [deleteClearState, setDeleteClearState] = useState(false);
  const [rescanTarget, setRescanTarget] = useState<GithubSyncConfig | null>(null);

  const enableMutation = useMutation(LIST_PATH, { method: 'PATCH', onSuccess: invalidate });
  const postMutation = useMutation(LIST_PATH, { method: 'POST', onSuccess: invalidate });
  const deleteMutation = useMutation(LIST_PATH, {
    method: 'DELETE',
    onSuccess: () => {
      toast.success('Sync configuration deleted');
      setDeleteTarget(null);
      setDeleteClearState(false);
      invalidate();
    },
  });
  const deleting = deleteMutation.isPending;

  const togglePause = (cfg: GithubSyncConfig) => {
    setBusyId(cfg.id);
    enableMutation.mutate(
      { path: `${LIST_PATH}/${cfg.id}/enabled`, body: { enabled: !cfg.enabled } },
      {
        onSuccess: () => toast.success(cfg.enabled ? 'Sync paused' : 'Sync resumed'),
        onSettled: () => setBusyId(null),
      }
    );
  };
  const runNow = (cfg: GithubSyncConfig) => {
    setBusyId(cfg.id);
    postMutation.mutate(
      { path: `${LIST_PATH}/${cfg.id}/run` },
      {
        onSuccess: () => toast.success(`Started sync for "${cfg.name}"`),
        onSettled: () => setBusyId(null),
      }
    );
  };
  const stopRun = (cfg: GithubSyncConfig) => {
    setBusyId(cfg.id);
    postMutation.mutate(
      { path: `${LIST_PATH}/${cfg.id}/stop` },
      { onSuccess: () => toast.success('Stop requested'), onSettled: () => setBusyId(null) }
    );
  };
  const confirmRescan = () => {
    if (!rescanTarget) return;
    const cfg = rescanTarget;
    setRescanTarget(null);
    setBusyId(cfg.id);
    postMutation.mutate(
      { path: `${LIST_PATH}/${cfg.id}/rescan` },
      {
        onSuccess: () => toast.success(`Full rescan started for "${cfg.name}"`),
        onSettled: () => setBusyId(null),
      }
    );
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    const q = deleteClearState ? '?clearState=true' : '';
    deleteMutation.mutate({ path: `${LIST_PATH}/${deleteTarget.id}${q}` });
  };

  return (
    <Card id="github" className="mb-6 scroll-mt-20 p-4">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Github className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold">GitHub Sync</h2>
          <Badge variant="outline" className="text-xs">
            {configs.length} configured
          </Badge>
        </div>
        {canEditSync && (
          <Button
            onClick={() => {
              setFormConfig(null);
              setFormOpen(true);
            }}
          >
            Add sync
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Periodically fetch Playwright report artifacts from GitHub Actions workflow runs and
          upload them as reports. Each entry runs on its own schedule.
        </p>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : configs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No sync configurations yet. Click <span className="font-medium">Add sync</span> to set
            one up.
          </p>
        ) : (
          <div className="space-y-3">
            {configs.map((cfg) => (
              <div
                key={cfg.id}
                className="border rounded-md p-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{cfg.name}</span>
                    {statusBadge(cfg)}
                    {!cfg.tokenSet && (
                      <Badge variant="outline" className="text-xs">
                        env token
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                    <dt className="text-muted-foreground/70">Repo</dt>
                    <dd
                      className="min-w-0 truncate font-mono"
                      title={`${cfg.repo} / ${cfg.workflow}`}
                    >
                      {cfg.repo} / {cfg.workflow}
                    </dd>
                    <dt className="text-muted-foreground/70">Pattern</dt>
                    <dd
                      className="min-w-0 truncate font-mono"
                      title={`${cfg.artifactPattern} → ${cfg.projectTemplate}`}
                    >
                      {cfg.artifactPattern} <span className="text-muted-foreground/70">→</span>{' '}
                      {cfg.projectTemplate}
                    </dd>
                    <dt className="text-muted-foreground/70">Schedule</dt>
                    <dd className="truncate font-mono">
                      {cfg.cronSchedule}
                      {cfg.status?.nextRun && cfg.enabled && (
                        <span className="font-sans text-muted-foreground">
                          {' '}
                          · next <FormattedDate date={cfg.status.nextRun} />
                        </span>
                      )}
                    </dd>
                    <dt className="text-muted-foreground/70">Synced</dt>
                    <dd className="truncate">
                      {cfg.status?.syncedArtifacts ?? 0} artifact(s)
                      {cfg.status?.lastRun?.message && (
                        <span
                          className={cn(
                            'text-muted-foreground',
                            (cfg.status.lastRun.failed ?? 0) > 0 && 'text-destructive'
                          )}
                          title={cfg.status.lastRun.message}
                        >
                          {' '}
                          · last: {cfg.status.lastRun.message}
                        </span>
                      )}
                    </dd>
                  </div>
                  {(cfg.status?.consecutiveFailures ?? 0) >= 3 && cfg.enabled && (
                    <div className="text-xs text-destructive">
                      Failing for {cfg.status?.consecutiveFailures} runs
                      {cfg.status?.failingSince && (
                        <>
                          {' '}
                          since <FormattedDate date={cfg.status.failingSince} />
                        </>
                      )}
                    </div>
                  )}
                  {cfg.status?.isRunning && cfg.status.progress && (
                    <SyncProgressPanel progress={cfg.status.progress} />
                  )}
                  <FailedArtifactsBlock
                    configId={cfg.id}
                    pendingArtifacts={cfg.status?.pendingArtifacts ?? 0}
                    abandonedArtifacts={cfg.status?.abandonedArtifacts ?? 0}
                    onRetry={() => runNow(cfg)}
                    retrying={busyId === cfg.id || !!cfg.status?.isRunning}
                    canRetry={canRunSync}
                  />
                  <SyncHistory configId={cfg.id} />
                </div>
                <div className="flex gap-2 flex-wrap sm:flex-nowrap shrink-0">
                  {cfg.status?.isRunning ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => stopRun(cfg)}
                      disabled={busyId === cfg.id}
                    >
                      {busyId === cfg.id && <Spinner className="mr-2 h-4 w-4" />}
                      Stop
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runNow(cfg)}
                      disabled={busyId === cfg.id}
                    >
                      {busyId === cfg.id && <Spinner className="mr-2 h-4 w-4" />}
                      Run now
                    </Button>
                  )}
                  {canRunSync && !cfg.status?.isRunning && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRescanTarget(cfg)}
                      disabled={busyId === cfg.id}
                    >
                      Rescan
                    </Button>
                  )}
                  {canEditSync && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => togglePause(cfg)}
                        disabled={busyId === cfg.id}
                      >
                        {cfg.enabled ? 'Pause' : 'Resume'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setFormConfig(cfg);
                          setFormOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setDeleteTarget(cfg);
                          setDeleteClearState(false);
                        }}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <GithubSyncFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        config={formConfig}
        onSaved={invalidate}
      />

      <Dialog open={!!rescanTarget} onOpenChange={(open) => !open && setRescanTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run a full rescan?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Scans every workflow run since{' '}
                  <span className="font-mono">{rescanTarget?.startDate?.slice(0, 10)}</span> and
                  uploads anything missing, including artifacts that were failed.
                </p>
                <p>
                  It cannot recover artifacts GitHub has already expired or runs older than the
                  github sync start date.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescanTarget(null)}>
              Cancel
            </Button>
            <Button onClick={confirmRescan}>Start rescan</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteClearState(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete sync configuration?</DialogTitle>
            <DialogDescription>
              This removes the configuration{' '}
              <span className="font-medium">{deleteTarget?.name}</span> and its run history.
              Already-uploaded reports are not affected.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 py-2">
            <input
              id="gs-clear-state"
              type="checkbox"
              checked={deleteClearState}
              onChange={(e) => setDeleteClearState(e.target.checked)}
              className="mt-1"
            />
            <div>
              <Label htmlFor="gs-clear-state" className="cursor-pointer">
                Also clear sync state
              </Label>
              <p className="text-xs text-muted-foreground">
                Forgets which GitHub artifacts have already been synced. If you re-add this
                configuration later, it will re-scan from the start date and may re-upload artifacts
                that are still available on GitHub.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleting}
              onClick={() => {
                setDeleteTarget(null);
                setDeleteClearState(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting && <Spinner className="mr-2 h-4 w-4" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

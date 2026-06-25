import {
  formatBytes,
  type GithubSyncConfig,
  type GithubSyncConfigInput,
  type GithubSyncStatus,
  type SyncPhase,
  type SyncProgress,
  type SyncTransfer,
} from '@playwright-reports/shared';
import { Fragment, useCallback, useEffect, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/hooks/useAuth';
import { useCan } from '@/hooks/useCan';
import { useServerEvents } from '@/hooks/useServerEvents';
import { errorMessage } from '@/lib/api';
import { authHeaders } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { GithubSyncTemplateFields } from './GithubSyncTemplateFields';

type GithubSyncConfigWithStatus = GithubSyncConfig & { status?: GithubSyncStatus };

interface FormState {
  name: string;
  repo: string;
  workflow: string;
  startDate: string;
  artifactPattern: string;
  projectTemplate: string;
  titleTemplate: string;
  cronSchedule: string;
  token: string;
  enabled: boolean;
}

const blankForm: FormState = {
  name: '',
  repo: '',
  workflow: '',
  // YYYY-MM-DDTHH:MM in the user's local time. Converted to UTC ISO on submit.
  startDate: utcIsoToLocalInput(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
  artifactPattern: '',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder syntax for server-side render
  projectTemplate: '${match1}',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder syntax for server-side render
  titleTemplate: '${runDate}',
  cronSchedule: '*/30 * * * *',
  token: '',
  enabled: true,
};

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
  const last = cfg.status?.lastRun?.status;
  if (last === 'failed') return <Badge variant="destructive">Last run failed</Badge>;
  if (last === 'cancelled') return <Badge variant="secondary">Cancelled</Badge>;
  if (last === 'success') return <Badge variant="success">OK</Badge>;
  return <Badge variant="outline">Idle</Badge>;
}

/** `YYYY-MM-DDTHH:MM` in the user's local time */
function utcIsoToLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Treat a `YYYY-MM-DDTHH:MM` string as local-time and convert to UTC ISO
 *  (`YYYY-MM-DDTHH:MM:SS.sssZ`). */
function localInputToUtcIso(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return local;
  return d.toISOString();
}

function browserTimezoneLabel(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  // `getTimezoneOffset` returns minutes *behind* UTC, so negate.
  const offsetMin = -new Date().getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const offsetStr = m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, '0')}`;
  return `${tz} · ${offsetStr}`;
}

async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const auth = authHeaders() as Record<string, string>;
  for (const [k, v] of Object.entries(auth)) headers.set(k, v);
  const hasBody = options.body !== undefined && options.body !== null;
  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  if (!res.ok) {
    const message = text || res.statusText;
    throw new Error(message);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export default function GithubSyncConfiguration() {
  const session = useAuth();
  // Editing sync configs is admin-only; Run/Stop stay available to readers.
  const canEditSync = useCan()('config:githubSync');
  const [configs, setConfigs] = useState<GithubSyncConfigWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GithubSyncConfig | null>(null);
  const [deleteClearState, setDeleteClearState] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api<GithubSyncConfigWithStatus[]>('/api/config/github-sync');
      setConfigs(data);
    } catch (error) {
      toast.error(`Failed to load GitHub sync configs: ${errorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session.status !== 'authenticated') return;
    refresh();
  }, [session.status, refresh]);

  useServerEvents('/api/config/github-sync/events', refresh, {
    enabled: session.status === 'authenticated',
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(blankForm);
    setFormOpen(true);
  };

  const openEdit = (cfg: GithubSyncConfig) => {
    setEditingId(cfg.id);
    setForm({
      name: cfg.name,
      repo: cfg.repo,
      workflow: cfg.workflow,
      startDate: utcIsoToLocalInput(cfg.startDate),
      artifactPattern: cfg.artifactPattern,
      projectTemplate: cfg.projectTemplate,
      titleTemplate: cfg.titleTemplate,
      cronSchedule: cfg.cronSchedule,
      token: '',
      enabled: cfg.enabled,
    });
    setFormOpen(true);
  };

  const submitForm = async () => {
    setSaving(true);
    try {
      const startDateUtc = localInputToUtcIso(form.startDate);
      const payload: Partial<GithubSyncConfigInput> = {
        name: form.name,
        repo: form.repo,
        workflow: form.workflow,
        startDate: startDateUtc,
        artifactPattern: form.artifactPattern,
        projectTemplate: form.projectTemplate,
        titleTemplate: form.titleTemplate,
        cronSchedule: form.cronSchedule,
        enabled: form.enabled,
      };
      if (form.token !== '') payload.token = form.token;

      if (editingId) {
        await api(`/api/config/github-sync/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        toast.success('Sync configuration updated');
      } else {
        await api('/api/config/github-sync', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        toast.success('Sync configuration created');
      }
      setFormOpen(false);
      await refresh();
    } catch (error) {
      toast.error(`Save failed: ${errorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const togglePause = async (cfg: GithubSyncConfig) => {
    setBusyId(cfg.id);
    try {
      await api(`/api/config/github-sync/${cfg.id}/enabled`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !cfg.enabled }),
      });
      toast.success(cfg.enabled ? 'Sync paused' : 'Sync resumed');
      await refresh();
    } catch (error) {
      toast.error(`Failed: ${errorMessage(error)}`);
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (cfg: GithubSyncConfig) => {
    setBusyId(cfg.id);
    try {
      await api(`/api/config/github-sync/${cfg.id}/run`, { method: 'POST' });
      toast.success(`Started sync for "${cfg.name}"`);
      await refresh();
    } catch (error) {
      toast.error(`Run failed: ${errorMessage(error)}`);
    } finally {
      setBusyId(null);
    }
  };

  const stopRun = async (cfg: GithubSyncConfig) => {
    setBusyId(cfg.id);
    try {
      await api(`/api/config/github-sync/${cfg.id}/stop`, { method: 'POST' });
      toast.success('Stop requested');
      await refresh();
    } catch (error) {
      toast.error(`Stop failed: ${errorMessage(error)}`);
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const q = deleteClearState ? '?clearState=true' : '';
      await api(`/api/config/github-sync/${deleteTarget.id}${q}`, { method: 'DELETE' });
      toast.success('Sync configuration deleted');
      setDeleteTarget(null);
      setDeleteClearState(false);
      await refresh();
    } catch (error) {
      toast.error(`Delete failed: ${errorMessage(error)}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card id="github" className="mb-6 scroll-mt-20 p-4">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">GitHub Sync</h2>
          <Badge variant="outline" className="text-xs">
            {configs.length} configured
          </Badge>
        </div>
        {canEditSync && <Button onClick={openCreate}>Add sync</Button>}
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Periodically fetch Playwright report artifacts from GitHub Actions workflow runs and
          upload them as reports. Each entry runs on its own schedule.
        </p>

        {loading ? (
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
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <div>
                      <span className="font-mono">{cfg.repo}</span> /{' '}
                      <span className="font-mono">{cfg.workflow}</span>
                    </div>
                    <div>
                      Pattern <span className="font-mono">{cfg.artifactPattern}</span> → project{' '}
                      <span className="font-mono">{cfg.projectTemplate}</span>
                    </div>
                    <div>
                      Schedule <span className="font-mono">{cfg.cronSchedule}</span>
                      {cfg.status?.nextRun && cfg.enabled && (
                        <>
                          {' '}
                          · next <FormattedDate date={cfg.status.nextRun} />
                        </>
                      )}
                    </div>
                    <div>
                      Synced {cfg.status?.syncedArtifacts ?? 0} artifact(s)
                      {cfg.status?.lastRun?.message && <> · last: {cfg.status.lastRun.message}</>}
                    </div>
                  </div>
                  {cfg.status?.isRunning && cfg.status.progress && (
                    <SyncProgressPanel progress={cfg.status.progress} />
                  )}
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
                      <Button size="sm" variant="outline" onClick={() => openEdit(cfg)}>
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

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit GitHub sync' : 'Add GitHub sync'}</DialogTitle>
            <DialogDescription>
              Each configuration polls one workflow on its own cron schedule and uploads matching
              artifacts as reports.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="gs-name">Name</Label>
              <Input
                id="gs-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. nightly e2e"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="gs-repo">Repository</Label>
                <Input
                  id="gs-repo"
                  value={form.repo}
                  onChange={(e) => setForm({ ...form, repo: e.target.value })}
                  placeholder="owner/name"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="gs-workflow">Workflow file</Label>
                <Input
                  id="gs-workflow"
                  value={form.workflow}
                  onChange={(e) => setForm({ ...form, workflow: e.target.value })}
                  placeholder="playwright.yml"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="gs-token">
                GitHub token {editingId && '(leave blank to keep current)'}
              </Label>
              <Input
                id="gs-token"
                type="password"
                value={form.token}
                onChange={(e) => setForm({ ...form, token: e.target.value })}
                placeholder="ghp_..."
              />
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Required permissions (read-only access):</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>
                    <span className="font-mono">Actions: Read-only</span> on the target repo.{' '}
                  </li>
                  <li>
                    <span className="font-mono">Metadata: Read-only</span> is granted automatically.
                  </li>
                </ul>
                <p>
                  If blank, falls back to the <span className="font-mono">GITHUB_TOKEN</span>{' '}
                  environment variable on the server. Stored encrypted.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="gs-start">
                  Start date & time{' '}
                  <span className="font-normal text-muted-foreground">
                    ({browserTimezoneLabel()})
                  </span>
                </Label>
                <Input
                  id="gs-start"
                  type="datetime-local"
                  step={60}
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Workflow runs completed before this point are ignored.
                  {form.startDate &&
                    (() => {
                      const utc = localInputToUtcIso(form.startDate);
                      return utc && utc !== form.startDate ? (
                        <>
                          {' '}
                          (Stored as <span className="font-mono">{utc}</span>)
                        </>
                      ) : null;
                    })()}
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="gs-cron">Cron schedule</Label>
                <Input
                  id="gs-cron"
                  value={form.cronSchedule}
                  onChange={(e) => setForm({ ...form, cronSchedule: e.target.value })}
                  placeholder="*/30 * * * *"
                />
              </div>
            </div>
            <GithubSyncTemplateFields
              artifactPattern={form.artifactPattern}
              projectTemplate={form.projectTemplate}
              titleTemplate={form.titleTemplate}
              repo={form.repo}
              workflow={form.workflow}
              onChange={(patch) => setForm({ ...form, ...patch })}
            />
            <div className="flex items-center gap-2">
              <input
                id="gs-enabled"
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              <Label htmlFor="gs-enabled" className="cursor-pointer">
                Enabled
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save' : 'Create'}
            </Button>
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

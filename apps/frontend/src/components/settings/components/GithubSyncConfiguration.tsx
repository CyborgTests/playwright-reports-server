import type {
  GithubSyncConfig,
  GithubSyncConfigInput,
  GithubSyncStatus,
  SyncProgress,
} from '@playwright-reports/shared';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
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
import { useAuth } from '@/hooks/useAuth';

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

function SyncProgressPanel({ progress }: { progress: SyncProgress }) {
  if (progress.phase === 'scanning') {
    return (
      <div className="rounded-md border bg-muted/30 p-2 space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">Scanning workflow runs…</span>
          <span className="text-muted-foreground">
            {progress.total} artifact{progress.total === 1 ? '' : 's'} found
          </span>
        </div>
        <Progress value={undefined} className="h-1.5 animate-pulse" />
      </div>
    );
  }
  const pct =
    progress.total > 0 ? Math.min(100, Math.round((progress.current / progress.total) * 100)) : 0;
  return (
    <div className="rounded-md border bg-muted/30 p-2 space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium tabular-nums">
          [{progress.current}/{progress.total}] {pct}%
        </span>
        <span className="text-muted-foreground tabular-nums">
          ✓ {progress.uploaded}
          {progress.failed > 0 ? ` · ✕ ${progress.failed}` : ''}
          {progress.skipped > 0 ? ` · skipped ${progress.skipped}` : ''}
        </span>
      </div>
      <Progress value={pct} className="h-1.5" />
      {progress.currentArtifact && (
        <div
          className="text-xs text-muted-foreground font-mono truncate"
          title={progress.currentArtifact}
        >
          ↓ {progress.currentArtifact}
        </div>
      )}
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

function authHeader(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('jwtToken') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface RegexInfo {
  ok: boolean;
  error?: string;
  captureCount: number;
  sampleArtifact: string;
  sampleMatches: string[];
}

function analyzeRegex(pattern: string): RegexInfo {
  if (!pattern.trim()) {
    return { ok: false, error: 'empty', captureCount: 0, sampleArtifact: '', sampleMatches: [] };
  }
  try {
    const re = new RegExp(pattern);
    // Count capture groups via the source — RegExp doesn't expose it directly.
    // Subtract non-capturing `(?:` and lookarounds `(?=`, `(?!`, `(?<=`, `(?<!`.
    const all = (pattern.match(/\((?!\?)/g) ?? []).length;
    const sample = sampleArtifactFor(pattern, re);
    const matchResult = sample ? sample.match(re) : null;
    return {
      ok: true,
      captureCount: all,
      sampleArtifact: sample,
      sampleMatches: matchResult ? Array.from(matchResult) : [],
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'invalid',
      captureCount: 0,
      sampleArtifact: '',
      sampleMatches: [],
    };
  }
}

/** Best-effort sample string the user might recognise. Tries a few well-known
 *  artifact names so the preview shows real-looking values for common patterns. */
function sampleArtifactFor(_pattern: string, re: RegExp): string {
  const candidates = [
    'playwright-report-chrome',
    'playwright-report-firefox',
    'playwright-report',
    'e2e-staging-report',
    'e2e-production-report',
    'report-shard-1',
    'test-results',
  ];
  for (const c of candidates) {
    if (re.test(c)) return c;
  }
  return '';
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

function renderTemplate(template: string, ctx: Record<string, string>, matches: string[]): string {
  return template.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_full, key: string) => {
    if (/^match\d+$/.test(key)) {
      const idx = Number.parseInt(key.slice(5), 10);
      return matches[idx] ?? '';
    }
    return ctx[key] ?? '';
  });
}

async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const auth = authHeader() as Record<string, string>;
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
  const [configs, setConfigs] = useState<GithubSyncConfigWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GithubSyncConfig | null>(null);
  const [deleteClearState, setDeleteClearState] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api<GithubSyncConfigWithStatus[]>('/api/config/github-sync');
      setConfigs(data);
    } catch (err) {
      toast.error(`Failed to load GitHub sync configs: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session.status !== 'authenticated') return;
    refresh();
  }, [session.status, refresh]);

  useEffect(() => {
    if (session.status !== 'authenticated') return;
    const anyRunning = configs.some((c) => c.status?.isRunning);
    // 1s while a sync is in flight for progress display, otherwise 30s
    const interval = anyRunning ? 1_000 : 30_000;
    const handle = window.setInterval(refresh, interval);
    return () => window.clearInterval(handle);
  }, [session.status, configs, refresh]);

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
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const togglePause = async (cfg: GithubSyncConfig) => {
    try {
      await api(`/api/config/github-sync/${cfg.id}/enabled`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !cfg.enabled }),
      });
      toast.success(cfg.enabled ? 'Sync paused' : 'Sync resumed');
      await refresh();
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    }
  };

  const runNow = async (cfg: GithubSyncConfig) => {
    try {
      await api(`/api/config/github-sync/${cfg.id}/run`, { method: 'POST' });
      toast.success(`Started sync for "${cfg.name}"`);
      await refresh();
    } catch (err) {
      toast.error(`Run failed: ${(err as Error).message}`);
    }
  };

  const stopRun = async (cfg: GithubSyncConfig) => {
    try {
      await api(`/api/config/github-sync/${cfg.id}/stop`, { method: 'POST' });
      toast.success('Stop requested');
      await refresh();
    } catch (err) {
      toast.error(`Stop failed: ${(err as Error).message}`);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const q = deleteClearState ? '?clearState=true' : '';
      await api(`/api/config/github-sync/${deleteTarget.id}${q}`, { method: 'DELETE' });
      toast.success('Sync configuration deleted');
      setDeleteTarget(null);
      setDeleteClearState(false);
      await refresh();
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
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
        <Button onClick={openCreate}>Add sync</Button>
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
                        <> · next {new Date(cfg.status.nextRun).toLocaleString()}</>
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
                    <Button size="sm" variant="outline" onClick={() => stopRun(cfg)}>
                      Stop
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => runNow(cfg)}>
                      Run now
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => togglePause(cfg)}>
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
            {(() => {
              const regexInfo = analyzeRegex(form.artifactPattern);
              const previewCtx: Record<string, string> = {
                branch: 'main',
                runDate: new Date().toISOString().slice(0, 10),
                runId: '1234567890',
                artifactName: regexInfo.sampleArtifact || '(no match)',
                repo: form.repo || 'owner/name',
                workflowFile: form.workflow || 'workflow.yml',
                workflowName: 'Playwright Tests',
              };
              const projectPreview = renderTemplate(
                form.projectTemplate,
                previewCtx,
                regexInfo.sampleMatches
              );
              const titlePreview = renderTemplate(
                form.titleTemplate,
                previewCtx,
                regexInfo.sampleMatches
              );

              return (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="gs-pattern">Artifact name regex</Label>
                    <Input
                      id="gs-pattern"
                      value={form.artifactPattern}
                      onChange={(e) => setForm({ ...form, artifactPattern: e.target.value })}
                      placeholder="^playwright-report-(.+)$"
                    />
                    <p className="text-xs text-muted-foreground">
                      Filters which workflow artifacts get uploaded. Use parentheses to capture
                      parts of the artifact name — those captures become{' '}
                      <span className="font-mono">{`$\{match1}`}</span>,{' '}
                      <span className="font-mono">{`$\{match2}`}</span>, … in the templates below.
                    </p>
                    {form.artifactPattern && !regexInfo.ok && (
                      <p className="text-xs text-destructive">Invalid regex: {regexInfo.error}</p>
                    )}
                    {regexInfo.ok && (
                      <p className="text-xs text-muted-foreground">
                        {regexInfo.captureCount === 0 ? (
                          <>
                            No capture groups detected — add parentheses to capture parts of the
                            name.
                          </>
                        ) : (
                          <>
                            {regexInfo.captureCount} capture group
                            {regexInfo.captureCount > 1 ? 's' : ''} available:{' '}
                            {Array.from({ length: regexInfo.captureCount }).map((_, i) => {
                              const name = `match${i + 1}`;
                              return (
                                <span key={name}>
                                  {i > 0 && ', '}
                                  <span className="font-mono">{`$\{${name}}`}</span>
                                </span>
                              );
                            })}
                          </>
                        )}
                      </p>
                    )}
                  </div>

                  <div className="space-y-3 rounded-md border p-3 bg-muted/30">
                    <div>
                      <h4 className="text-sm font-medium">Naming for synced reports</h4>
                      <p className="text-xs text-muted-foreground">
                        These templates build the <span className="font-medium">project name</span>{' '}
                        (used to group reports in the dashboard) and the{' '}
                        <span className="font-medium">title</span> (shown on each report) for every
                        artifact this sync uploads. Mix literal text with{' '}
                        <span className="font-mono">{`$\{placeholder}`}</span> tokens.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="gs-project">Project name template</Label>
                        <Input
                          id="gs-project"
                          value={form.projectTemplate}
                          onChange={(e) => setForm({ ...form, projectTemplate: e.target.value })}
                          placeholder="${match1}:${branch}"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="gs-title">Report title template</Label>
                        <Input
                          id="gs-title"
                          value={form.titleTemplate}
                          onChange={(e) => setForm({ ...form, titleTemplate: e.target.value })}
                          placeholder="${runDate}"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs font-medium">Available placeholders</p>
                      <ul className="text-xs text-muted-foreground space-y-0.5 list-disc pl-4">
                        <li>
                          <span className="font-mono">{`$\{match1}`}</span>,{' '}
                          <span className="font-mono">{`$\{match2}`}</span>, … — capture groups from
                          the regex above (e.g. the part in parentheses)
                        </li>
                        <li>
                          <span className="font-mono">{`$\{branch}`}</span> — git branch the
                          workflow ran on
                        </li>
                        <li>
                          <span className="font-mono">{`$\{runDate}`}</span> — date the workflow ran
                          (YYYY-MM-DD)
                        </li>
                        <li>
                          <span className="font-mono">{`$\{workflowName}`}</span> — display name of
                          the workflow (e.g. "Playwright Tests")
                        </li>
                        <li>
                          <span className="font-mono">{`$\{workflowFile}`}</span> — workflow file
                          name (e.g. "playwright.yml")
                        </li>
                        <li>
                          <span className="font-mono">{`$\{runId}`}</span>,{' '}
                          <span className="font-mono">{`$\{artifactName}`}</span>,{' '}
                          <span className="font-mono">{`$\{repo}`}</span>
                        </li>
                      </ul>
                    </div>

                    <div className="space-y-1 border-t pt-2">
                      <p className="text-xs font-medium">Preview</p>
                      {regexInfo.ok && regexInfo.sampleArtifact ? (
                        <div className="text-xs space-y-0.5 font-mono">
                          <div className="text-muted-foreground">
                            artifact: {regexInfo.sampleArtifact}
                          </div>
                          <div>
                            <span className="text-muted-foreground">project →</span>{' '}
                            <span className="font-medium">{projectPreview || '(empty)'}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">title →</span>{' '}
                            <span className="font-medium">{titlePreview || '(empty)'}</span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">
                          Enter a valid regex above to see a worked example.
                        </p>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}
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
              onClick={() => {
                setDeleteTarget(null);
                setDeleteClearState(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

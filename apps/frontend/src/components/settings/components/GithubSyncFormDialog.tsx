import type { GithubSyncConfig, GithubSyncConfigInput } from '@playwright-reports/shared';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import useMutation from '@/hooks/useMutation';
import { GithubSyncTemplateFields } from './GithubSyncTemplateFields';

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

/** `YYYY-MM-DDTHH:MM` in the user's local time */
function utcIsoToLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Treat a `YYYY-MM-DDTHH:MM` string as local-time and convert to UTC ISO. */
function localInputToUtcIso(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return local;
  return d.toISOString();
}

function browserTimezoneLabel(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  const offsetMin = -new Date().getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const offsetStr = m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, '0')}`;
  return `${tz} · ${offsetStr}`;
}

const blankForm: FormState = {
  name: '',
  repo: '',
  workflow: '',
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

function formFromConfig(cfg: GithubSyncConfig): FormState {
  return {
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
  };
}

export function GithubSyncFormDialog({
  open,
  onOpenChange,
  config,
  onSaved,
}: Readonly<{
  open: boolean;
  onOpenChange: (v: boolean) => void;
  config: GithubSyncConfig | null;
  onSaved: () => void;
}>) {
  const [form, setForm] = useState<FormState>(blankForm);

  useEffect(() => {
    if (open) setForm(config ? formFromConfig(config) : blankForm);
  }, [open, config]);

  const finish = (msg: string) => {
    toast.success(msg);
    onSaved();
    onOpenChange(false);
  };
  const createMutation = useMutation('/api/config/github-sync', {
    method: 'POST',
    onSuccess: () => finish('Sync configuration created'),
  });
  const updateMutation = useMutation('/api/config/github-sync', {
    method: 'PATCH',
    onSuccess: () => finish('Sync configuration updated'),
  });
  const saving = createMutation.isPending || updateMutation.isPending;

  const submit = () => {
    const payload: Partial<GithubSyncConfigInput> = {
      name: form.name,
      repo: form.repo,
      workflow: form.workflow,
      startDate: localInputToUtcIso(form.startDate),
      artifactPattern: form.artifactPattern,
      projectTemplate: form.projectTemplate,
      titleTemplate: form.titleTemplate,
      cronSchedule: form.cronSchedule,
      enabled: form.enabled,
    };
    if (form.token !== '') payload.token = form.token;
    if (config)
      updateMutation.mutate({ path: `/api/config/github-sync/${config.id}`, body: payload });
    else createMutation.mutate({ body: payload });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{config ? 'Edit GitHub sync' : 'Add GitHub sync'}</DialogTitle>
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
              GitHub token {config && '(leave blank to keep current)'}
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : config ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

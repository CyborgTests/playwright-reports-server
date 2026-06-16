import {
  isOpaqueMaskSentinel,
  isUrlMaskSentinel,
  type NotificationChannel,
  SECRET_MASK,
  type SlackChannelConfig,
  type WebhookChannelConfig,
} from '@playwright-reports/shared';
import { useEffect, useMemo, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

interface ChannelFormDialogProps {
  open: boolean;
  channel?: NotificationChannel;
  baseUrlMissing?: boolean;
  onCancel: () => void;
  onSubmit: (next: NotificationChannel) => void;
}

interface HeaderRow {
  key: string;
  value: string;
}

interface StoredSecretFlags {
  webhookUrl: boolean;
  url: boolean;
  hmacKey: boolean;
  headerKeys: Set<string>;
}

function emptyStoredFlags(): StoredSecretFlags {
  return { webhookUrl: false, url: false, hmacKey: false, headerKeys: new Set() };
}

function detectStoredSecrets(channel: NotificationChannel | undefined): StoredSecretFlags {
  if (!channel) return emptyStoredFlags();
  if (channel.type === 'slack') {
    return {
      ...emptyStoredFlags(),
      webhookUrl: isUrlMaskSentinel((channel.config as SlackChannelConfig).webhookUrl),
    };
  }
  const cfg = channel.config as WebhookChannelConfig;
  const headerKeys = new Set<string>();
  for (const [k, v] of Object.entries(cfg.headers ?? {})) {
    if (isOpaqueMaskSentinel(v)) headerKeys.add(k);
  }
  return {
    webhookUrl: false,
    url: isUrlMaskSentinel(cfg.url),
    hmacKey: isOpaqueMaskSentinel(cfg.secretHmacKey),
    headerKeys,
  };
}

function clearStoredSecrets(
  channel: NotificationChannel | undefined
): NotificationChannel | undefined {
  if (!channel) return channel;
  if (channel.type === 'slack') {
    const cfg = channel.config as SlackChannelConfig;
    return {
      ...channel,
      config: { webhookUrl: isUrlMaskSentinel(cfg.webhookUrl) ? '' : cfg.webhookUrl },
    };
  }
  const cfg = channel.config as WebhookChannelConfig;
  const headers: Record<string, string> | undefined = cfg.headers
    ? Object.fromEntries(
        Object.entries(cfg.headers).map(([k, v]) => [k, isOpaqueMaskSentinel(v) ? '' : v])
      )
    : undefined;
  return {
    ...channel,
    config: {
      url: isUrlMaskSentinel(cfg.url) ? '' : cfg.url,
      headers,
      secretHmacKey: isOpaqueMaskSentinel(cfg.secretHmacKey) ? '' : cfg.secretHmacKey,
    },
  };
}

function restoreStoredSecrets(
  draft: NotificationChannel,
  flags: StoredSecretFlags
): NotificationChannel {
  if (draft.type === 'slack') {
    const cfg = draft.config as SlackChannelConfig;
    return {
      ...draft,
      config: {
        webhookUrl: flags.webhookUrl && cfg.webhookUrl === '' ? SECRET_MASK : cfg.webhookUrl,
      },
    };
  }
  const cfg = draft.config as WebhookChannelConfig;
  const headers = cfg.headers
    ? Object.fromEntries(
        Object.entries(cfg.headers).map(([k, v]) => [
          k,
          flags.headerKeys.has(k) && v === '' ? SECRET_MASK : v,
        ])
      )
    : undefined;
  return {
    ...draft,
    config: {
      url: flags.url && cfg.url === '' ? SECRET_MASK : cfg.url,
      headers,
      secretHmacKey:
        flags.hmacKey && (cfg.secretHmacKey ?? '') === '' ? SECRET_MASK : cfg.secretHmacKey,
    },
  };
}

function buildNewChannel(type: 'slack' | 'webhook'): NotificationChannel {
  const base = {
    id: crypto.randomUUID(),
    name: type === 'slack' ? 'Slack' : 'Webhook',
    enabled: true,
    rules: [],
  };
  if (type === 'slack') {
    return {
      ...base,
      type: 'slack',
      config: { webhookUrl: '' } satisfies SlackChannelConfig,
    };
  }
  return {
    ...base,
    type: 'webhook',
    config: { url: '' } satisfies WebhookChannelConfig,
  };
}

export function ChannelFormDialog({
  open,
  channel,
  baseUrlMissing,
  onCancel,
  onSubmit,
}: Readonly<ChannelFormDialogProps>) {
  const isEdit = !!channel;

  const [draft, setDraft] = useState<NotificationChannel>(
    () => clearStoredSecrets(channel) ?? buildNewChannel('slack')
  );

  const [storedFlags, setStoredFlags] = useState<StoredSecretFlags>(() =>
    detectStoredSecrets(channel)
  );

  useEffect(() => {
    if (open) {
      setDraft(clearStoredSecrets(channel) ?? buildNewChannel('slack'));
      setStoredFlags(detectStoredSecrets(channel));
    }
  }, [open, channel]);

  const handleTypeChange = (next: 'slack' | 'webhook') => {
    if (next === draft.type) return;
    if (next === 'slack') {
      setDraft({
        ...draft,
        type: 'slack',
        config: { webhookUrl: '' },
      });
    } else {
      setDraft({
        ...draft,
        type: 'webhook',
        config: { url: '' },
      });
    }
  };

  const headerRows: HeaderRow[] = useMemo(() => {
    if (draft.type !== 'webhook') return [];
    const cfg = draft.config as WebhookChannelConfig;
    return cfg.headers ? Object.entries(cfg.headers).map(([key, value]) => ({ key, value })) : [];
  }, [draft]);

  const updateConfig = (patch: Partial<SlackChannelConfig & WebhookChannelConfig>) => {
    setDraft({
      ...draft,
      config: { ...draft.config, ...patch },
    } as NotificationChannel);
  };

  const setHeaders = (rows: HeaderRow[]) => {
    if (draft.type !== 'webhook') return;
    const cfg = draft.config as WebhookChannelConfig;
    const headers: Record<string, string> = {};
    for (const { key, value } of rows) {
      if (key.trim()) headers[key.trim()] = value;
    }
    setDraft({
      ...draft,
      config: { ...cfg, headers: Object.keys(headers).length > 0 ? headers : undefined },
    });
  };

  const slackConfig = draft.type === 'slack' ? (draft.config as SlackChannelConfig) : null;
  const webhookConfig = draft.type === 'webhook' ? (draft.config as WebhookChannelConfig) : null;

  const slackUrlFilled =
    !!slackConfig && (!!slackConfig.webhookUrl.trim() || storedFlags.webhookUrl);
  const webhookUrlFilled = !!webhookConfig && (!!webhookConfig.url.trim() || storedFlags.url);
  const canSubmit = !!draft.name.trim() && (slackUrlFilled || webhookUrlFilled);

  const handleSave = () => {
    onSubmit(restoreStoredSecrets(draft, storedFlags));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit channel' : 'Add channel'}</DialogTitle>
          <DialogDescription>
            Rules are added separately after the channel is saved.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {baseUrlMissing && (
            <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
              <p className="font-medium">⚠ Set Server Base URL before saving</p>
              <p className="text-muted-foreground mt-0.5">
                Without an absolute origin in <em>Server Configuration</em>, Slack will reject
                buttons (<code>invalid_blocks</code>) and webhook payloads will have unusable
                relative URLs.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="channel-type">Type</Label>
            <Select
              value={draft.type}
              onValueChange={(v) => handleTypeChange(v as 'slack' | 'webhook')}
              disabled={isEdit}
            >
              <SelectTrigger id="channel-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="slack">Slack (incoming webhook)</SelectItem>
                <SelectItem value="webhook">Generic webhook</SelectItem>
              </SelectContent>
            </Select>
            {isEdit && (
              <p className="text-xs text-muted-foreground">
                Type can't be changed after creation. Delete and recreate to switch.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="channel-name">Name</Label>
            <Input
              id="channel-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="qa-alerts"
              maxLength={100}
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="channel-enabled"
              checked={draft.enabled}
              onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
            />
            <Label htmlFor="channel-enabled">Enabled</Label>
          </div>

          {slackConfig && (
            <div className="space-y-2">
              <Label htmlFor="channel-webhook-url">Incoming webhook URL</Label>
              <Input
                id="channel-webhook-url"
                type="password"
                value={slackConfig.webhookUrl}
                onChange={(e) => updateConfig({ webhookUrl: e.target.value })}
                placeholder={
                  storedFlags.webhookUrl
                    ? 'Stored — leave blank to keep'
                    : 'https://hooks.slack.com/services/...'
                }
                maxLength={2000}
              />
              <p className="text-xs text-muted-foreground">
                Create one in Slack: Apps → Incoming Webhooks → Add to Slack → pick a channel → copy
                the URL.
              </p>
            </div>
          )}

          {webhookConfig && (
            <>
              <div className="space-y-2">
                <Label htmlFor="channel-url">URL</Label>
                <Input
                  id="channel-url"
                  type="password"
                  value={webhookConfig.url}
                  onChange={(e) => updateConfig({ url: e.target.value })}
                  placeholder={
                    storedFlags.url ? 'Stored — leave blank to keep' : 'https://example.com/notify'
                  }
                  maxLength={2000}
                />
              </div>

              <div className="space-y-2">
                <Label>Headers (optional)</Label>
                <HeaderEditor
                  rows={headerRows}
                  storedHeaderKeys={storedFlags.headerKeys}
                  onChange={setHeaders}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="channel-hmac">HMAC signing key (optional)</Label>
                <Input
                  id="channel-hmac"
                  type="password"
                  value={webhookConfig.secretHmacKey ?? ''}
                  onChange={(e) => updateConfig({ secretHmacKey: e.target.value || undefined })}
                  placeholder={
                    storedFlags.hmacKey ? 'Stored — leave blank to keep' : 'Shared secret'
                  }
                  maxLength={512}
                />
                <p className="text-xs text-muted-foreground">
                  When set, requests carry{' '}
                  <code className="text-foreground">X-PWRS-Signature: sha256=…</code> computed over
                  the request body.
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSubmit}>
            {isEdit ? 'Save' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface HeaderEditorProps {
  rows: HeaderRow[];
  storedHeaderKeys: Set<string>;
  onChange: (rows: HeaderRow[]) => void;
}

function HeaderEditor({ rows, storedHeaderKeys, onChange }: Readonly<HeaderEditorProps>) {
  const updateRow = (idx: number, patch: Partial<HeaderRow>) => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const removeRow = (idx: number) => onChange(rows.filter((_, i) => i !== idx));
  const addRow = () => onChange([...rows, { key: '', value: '' }]);

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No custom headers.</p>
      )}
      {rows.map((row, idx) => {
        const stored = storedHeaderKeys.has(row.key);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: stable in-place editing
          <div key={idx} className="flex gap-2">
            <Input
              value={row.key}
              onChange={(e) => updateRow(idx, { key: e.target.value })}
              placeholder="Header name"
              maxLength={200}
            />
            <Input
              value={row.value}
              type={stored ? 'password' : 'text'}
              onChange={(e) => updateRow(idx, { value: e.target.value })}
              placeholder={stored ? 'Stored — leave blank to keep' : 'Value'}
              maxLength={1000}
            />
            <Button variant="ghost" size="sm" onClick={() => removeRow(idx)}>
              Remove
            </Button>
          </div>
        );
      })}
      <Button variant="outline" size="sm" onClick={addRow}>
        Add header
      </Button>
    </div>
  );
}

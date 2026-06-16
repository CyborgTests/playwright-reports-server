'use client';

import type {
  NotificationChannel,
  NotificationRule,
  NotificationsConfig,
} from '@playwright-reports/shared';
import { AlertTriangle, Bell, Plus, Slack, Trash2, Webhook } from 'lucide-react';
import { useState } from 'react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useConfig } from '@/hooks/useConfig';
import {
  useNotificationsConfig,
  useUpdateNotificationsConfig,
} from '@/hooks/useNotificationsConfig';
import { ChannelFormDialog } from './notifications/ChannelFormDialog';
import { DeliveryLogPanel } from './notifications/DeliveryLogPanel';
import { RuleFormDialog } from './notifications/RuleFormDialog';

const EMPTY: NotificationsConfig = { enabled: false, channels: [] };

export default function NotificationsConfiguration() {
  const { data, isLoading } = useNotificationsConfig();
  const { data: siteConfig } = useConfig();
  const update = useUpdateNotificationsConfig();
  const config = data ?? EMPTY;

  const baseUrlMissing = !siteConfig?.serverBaseUrl?.trim();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<NotificationChannel | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<NotificationChannel | undefined>(undefined);

  const [ruleEditor, setRuleEditor] = useState<
    { channelId: string; rule?: NotificationRule } | undefined
  >(undefined);

  const persist = (next: NotificationsConfig) => update.mutate(next);

  const toggleEnabled = (enabled: boolean) => {
    persist({ ...config, enabled });
  };

  const toggleChannelEnabled = (channel: NotificationChannel, enabled: boolean) => {
    persist({
      ...config,
      channels: config.channels.map((c) => (c.id === channel.id ? { ...c, enabled } : c)),
    });
  };

  const openAdd = () => {
    setEditing(undefined);
    setFormOpen(true);
  };

  const openEdit = (channel: NotificationChannel) => {
    setEditing(channel);
    setFormOpen(true);
  };

  const handleSubmit = (next: NotificationChannel) => {
    const exists = config.channels.some((c) => c.id === next.id);
    const channels = exists
      ? config.channels.map((c) => (c.id === next.id ? next : c))
      : [...config.channels, next];
    persist({ ...config, channels });
    setFormOpen(false);
    setEditing(undefined);
  };

  const handleDelete = () => {
    if (!pendingDelete) return;
    persist({
      ...config,
      channels: config.channels.filter((c) => c.id !== pendingDelete.id),
    });
    setPendingDelete(undefined);
  };

  const openRuleAdd = (channelId: string) => setRuleEditor({ channelId });
  const openRuleEdit = (channelId: string, rule: NotificationRule) =>
    setRuleEditor({ channelId, rule });
  const closeRuleEditor = () => setRuleEditor(undefined);

  const handleRuleSubmit = (next: NotificationRule) => {
    if (!ruleEditor) return;
    const target = config.channels.find((c) => c.id === ruleEditor.channelId);
    if (!target) return;
    const exists = target.rules.some((r) => r.id === next.id);
    const rules = exists
      ? target.rules.map((r) => (r.id === next.id ? next : r))
      : [...target.rules, next];
    persist({
      ...config,
      channels: config.channels.map((c) => (c.id === target.id ? { ...c, rules } : c)),
    });
    closeRuleEditor();
  };

  const deleteRule = (channelId: string, ruleId: string) => {
    const target = config.channels.find((c) => c.id === channelId);
    if (!target) return;
    persist({
      ...config,
      channels: config.channels.map((c) =>
        c.id === channelId ? { ...c, rules: c.rules.filter((r) => r.id !== ruleId) } : c
      ),
    });
  };

  const toggleRuleEnabled = (channelId: string, ruleId: string, enabled: boolean) => {
    const target = config.channels.find((c) => c.id === channelId);
    if (!target) return;
    persist({
      ...config,
      channels: config.channels.map((c) =>
        c.id === channelId
          ? {
              ...c,
              rules: c.rules.map((r) => (r.id === ruleId ? { ...r, enabled } : r)),
            }
          : c
      ),
    });
  };

  const channelForRuleEditor = ruleEditor
    ? config.channels.find((c) => c.id === ruleEditor.channelId)
    : undefined;

  return (
    <Card id="notifications" className="mb-6 scroll-mt-20 p-4">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Notifications</h2>
          <Badge variant={config.enabled ? 'success' : 'secondary'}>
            {config.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Enable</span>
            <Switch
              id="notifications-enabled"
              checked={config.enabled}
              onCheckedChange={toggleEnabled}
              disabled={update.isPending}
            />
          </div>
          <Button onClick={openAdd} disabled={update.isPending}>
            Add channel
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {baseUrlMissing && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Server Base URL is not set</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Slack rejects buttons with relative URLs as <code>invalid_blocks</code>, and webhook
                consumers receive unusable paths. Set it under{' '}
                <a href="#server" className="underline">
                  Server Configuration
                </a>{' '}
                so report links work.
              </p>
            </div>
          </div>
        )}
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : config.channels.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-2">
            No channels configured. Add a Slack or webhook channel to start receiving notifications
            about new reports.
          </p>
        ) : (
          <div className="space-y-2">
            {config.channels.map((channel) => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                onToggle={(v) => toggleChannelEnabled(channel, v)}
                onEdit={() => openEdit(channel)}
                onDelete={() => setPendingDelete(channel)}
                onAddRule={() => openRuleAdd(channel.id)}
                onEditRule={(rule) => openRuleEdit(channel.id, rule)}
                onDeleteRule={(rule) => deleteRule(channel.id, rule.id)}
                onToggleRule={(rule, v) => toggleRuleEnabled(channel.id, rule.id, v)}
                disabled={update.isPending}
              />
            ))}
          </div>
        )}

        {!isLoading && config.channels.length > 0 && (
          <div className="mt-6 border-t pt-4">
            <DeliveryLogPanel channels={config.channels} />
          </div>
        )}
      </CardContent>

      <ChannelFormDialog
        open={formOpen}
        channel={editing}
        baseUrlMissing={baseUrlMissing}
        onCancel={() => {
          setFormOpen(false);
          setEditing(undefined);
        }}
        onSubmit={handleSubmit}
      />

      {channelForRuleEditor && (
        <RuleFormDialog
          open={!!ruleEditor}
          rule={ruleEditor?.rule}
          channelType={channelForRuleEditor.type}
          channelId={channelForRuleEditor.id}
          onCancel={closeRuleEditor}
          onSubmit={handleRuleSubmit}
        />
      )}

      <Dialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete channel?</DialogTitle>
            <DialogDescription>
              <span className="font-medium">{pendingDelete?.name}</span> will be removed. Its rules
              and delivery history will be lost. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(undefined)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="h-4 w-4 mr-1" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

interface ChannelCardProps {
  channel: NotificationChannel;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddRule: () => void;
  onEditRule: (rule: NotificationRule) => void;
  onDeleteRule: (rule: NotificationRule) => void;
  onToggleRule: (rule: NotificationRule, enabled: boolean) => void;
  disabled?: boolean;
}

function ChannelCard({
  channel,
  onToggle,
  onEdit,
  onDelete,
  onAddRule,
  onEditRule,
  onDeleteRule,
  onToggleRule,
  disabled,
}: Readonly<ChannelCardProps>) {
  const Icon = channel.type === 'slack' ? Slack : Webhook;
  const typeLabel = channel.type === 'slack' ? 'Slack' : 'Webhook';

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-3 px-4 py-3 border-b">
        <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{channel.name}</span>
            <Badge variant="secondary" className="text-xs">
              {typeLabel}
            </Badge>
          </div>
        </div>
        <Switch checked={channel.enabled} onCheckedChange={onToggle} disabled={disabled} />
        <Button variant="outline" size="sm" onClick={onEdit} disabled={disabled}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={disabled}
          aria-label="Delete channel"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-3 space-y-2">
        {channel.rules.length === 0 ? (
          <p className="text-xs text-muted-foreground italic px-1 py-2">
            No rules yet. Add a rule to start sending notifications.
          </p>
        ) : (
          channel.rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              onEdit={() => onEditRule(rule)}
              onDelete={() => onDeleteRule(rule)}
              onToggle={(v) => onToggleRule(rule, v)}
              disabled={disabled}
            />
          ))
        )}
        <Button variant="outline" size="sm" onClick={onAddRule} disabled={disabled}>
          <Plus className="h-4 w-4 mr-1" />
          Add rule
        </Button>
      </div>
    </div>
  );
}

interface RuleRowProps {
  rule: NotificationRule;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  disabled?: boolean;
}

function RuleRow({ rule, onEdit, onDelete, onToggle, disabled }: Readonly<RuleRowProps>) {
  const kindLabel = rule.kind === 'event' ? 'On upload' : 'Scheduled';
  const conditionLabel = formatCondition(rule);
  const filterLabel = formatFilter(rule.projectFilter);
  const ruleEnabled = rule.enabled !== false;

  return (
    <div
      className={`flex items-center gap-2 rounded border bg-background px-3 py-2 text-sm ${
        ruleEnabled ? '' : 'opacity-60'
      }`}
    >
      <Switch
        checked={ruleEnabled}
        onCheckedChange={onToggle}
        disabled={disabled}
        aria-label={ruleEnabled ? 'Disable rule' : 'Enable rule'}
      />
      <Badge variant="outline" className="text-xs shrink-0">
        {kindLabel}
      </Badge>
      <span className="truncate">{conditionLabel}</span>
      <span className="text-muted-foreground text-xs truncate">· {filterLabel}</span>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onEdit} disabled={disabled}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={disabled}
          aria-label="Delete rule"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function formatCondition(rule: NotificationRule): string {
  if (rule.kind === 'event') {
    switch (rule.condition) {
      case 'always':
        return 'Every report';
      case 'has_failures':
        return 'When there are failures';
      case 'pass_rate_below_100':
        return 'When pass rate < 100%';
      case 'recovered_to_clean':
        return 'When recovered to 100% pass';
      case 'recovered_no_hard_failures':
        return 'When hard failures resolved';
      default:
        return rule.condition;
    }
  }
  const cadence = typeof rule.cadence === 'string' ? rule.cadence : `cron ${rule.cadence.cron}`;
  const time = rule.sendAt;
  const cond =
    rule.condition === 'always'
      ? ''
      : rule.condition === 'all_clean'
        ? ' · only when all clean'
        : ' · only when no hard failures';
  return `${cadence} ${time}${cond}`;
}

function formatFilter(filter: NotificationRule['projectFilter']): string {
  switch (filter.mode) {
    case 'all':
      return 'all projects';
    case 'project':
      return `project: ${filter.name || '(empty)'}`;
    case 'regex':
      return `regex: ${filter.pattern || '(empty)'}`;
  }
}

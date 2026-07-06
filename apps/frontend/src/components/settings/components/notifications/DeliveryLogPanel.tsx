import type { NotificationChannel, NotificationLogEntry } from '@playwright-reports/shared';
import { formatRelativeTime } from '@playwright-reports/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  SkipForward,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useNotificationLog } from '@/hooks/useNotificationLog';
import { authHeaders } from '@/lib/auth';
import { withBase } from '@/lib/url';

interface DeliveryLogPanelProps {
  channels: NotificationChannel[];
}

type StatusFilter = 'all' | 'success' | 'failed' | 'skipped';

export function DeliveryLogPanel({ channels }: Readonly<DeliveryLogPanelProps>) {
  const [collapsed, setCollapsed] = useState(true);
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);

  const { data, isLoading, refetch, isFetching } = useNotificationLog(
    {
      channelId: channelFilter === 'all' ? undefined : channelFilter,
      status: statusFilter === 'all' ? undefined : statusFilter,
      limit: 50,
      offset: 0,
    },
    { enabled: !collapsed }
  );

  const rows = data?.rows ?? [];
  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someChecked = !allChecked && visibleIds.some((id) => selected.has(id));

  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notifications', 'log'] });

  const deleteSingle = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(withBase(`/api/notifications/log/${id}`), {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      return id;
    },
    onSuccess: (id) => {
      setSelected((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      invalidate();
    },
    onError: (err) => toast.error(`Failed to delete: ${err instanceof Error ? err.message : err}`),
  });

  const deleteBulk = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch(withBase('/api/notifications/log/delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return ids.length;
    },
    onSuccess: (count) => {
      toast.success(`Deleted ${count} entr${count === 1 ? 'y' : 'ies'}`);
      setSelected(new Set());
      setBulkConfirm(false);
      invalidate();
    },
    onError: (err) => {
      toast.error(`Bulk delete failed: ${err instanceof Error ? err.message : err}`);
      setBulkConfirm(false);
    },
  });

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allChecked) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of visibleIds) next.add(id);
        return next;
      });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-1 text-sm font-semibold hover:opacity-80"
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          Delivery log
        </button>
        {data && <Stats data={data.last24h} />}
        {!collapsed && (
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue placeholder="All channels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All channels</SelectItem>
                {channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue placeholder="Any status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Refresh"
            >
              <RotateCcw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        )}
      </div>

      {!collapsed && (
        <>
          {selected.size > 0 && (
            <div className="flex items-center gap-2 rounded border bg-muted/30 px-3 py-1.5 text-xs">
              <span>{selected.size} selected</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="ml-auto"
                onClick={() => setBulkConfirm(true)}
                disabled={deleteBulk.isPending}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Delete selected
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-1 py-3">
              No delivery log entries yet.
            </p>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 px-3 text-[11px] text-muted-foreground">
                <Checkbox
                  checked={allChecked ? true : someChecked ? 'indeterminate' : false}
                  onCheckedChange={toggleAll}
                  aria-label="Select all visible rows"
                />
                <span>Select all ({rows.length})</span>
              </div>
              {rows.map((row) => (
                <LogRow
                  key={row.id}
                  entry={row}
                  channels={channels}
                  checked={selected.has(row.id)}
                  onToggle={() => toggleRow(row.id)}
                  onDelete={() => deleteSingle.mutate(row.id)}
                  deleting={deleteSingle.isPending && deleteSingle.variables === row.id}
                />
              ))}
            </div>
          )}
        </>
      )}

      <Dialog open={bulkConfirm} onOpenChange={(o) => !o && setBulkConfirm(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Delete {selected.size} delivery log entr{selected.size === 1 ? 'y' : 'ies'}?
            </DialogTitle>
            <DialogDescription>
              The selected rows will be removed from the database. This can’t be undone, but new
              deliveries continue to be logged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteBulk.mutate([...selected])}
              disabled={deleteBulk.isPending}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface StatsProps {
  data: { success: number; failed: number; skipped: number };
}

function Stats({ data }: Readonly<StatsProps>) {
  return (
    <span className="text-xs text-muted-foreground">
      24h: <span className="text-success font-medium">{data.success} success</span>
      {' · '}
      <span className="text-danger font-medium">{data.failed} failed</span>
      {' · '}
      <span className="text-muted-foreground font-medium">{data.skipped} skipped</span>
    </span>
  );
}

interface LogRowProps {
  entry: NotificationLogEntry;
  channels: NotificationChannel[];
  checked: boolean;
  onToggle: () => void;
  onDelete: () => void;
  deleting: boolean;
}

function LogRow({ entry, channels, checked, onToggle, onDelete, deleting }: Readonly<LogRowProps>) {
  const channelName = channels.find((c) => c.id === entry.channelId)?.name ?? entry.channelType;
  const ago = formatRelativeTime(entry.createdAt);
  const detail = entry.error || entry.skipReason || undefined;

  return (
    <div
      className={`grid grid-cols-[auto_auto_1fr_auto_auto] items-start gap-2 rounded border bg-card px-3 py-2 text-xs ${
        deleting ? 'opacity-50 pointer-events-none' : ''
      }`}
    >
      <div className="pt-0.5">
        <Checkbox checked={checked} onCheckedChange={onToggle} aria-label="Select row" />
      </div>
      <StatusIcon entry={entry} />
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{channelName}</span>
          <Badge variant="outline" className="text-[10px]">
            {entry.ruleKind}
          </Badge>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground truncate">{entry.condition}</span>
          {entry.source === 'test' && (
            <Badge variant="secondary" className="text-[10px]">
              test
            </Badge>
          )}
          {entry.httpStatus !== undefined && entry.httpStatus !== null && (
            <span className="text-muted-foreground">HTTP {entry.httpStatus}</span>
          )}
          {entry.attempt > 1 && (
            <span className="text-muted-foreground">attempt {entry.attempt}</span>
          )}
        </div>
        {detail && <div className="mt-0.5 text-muted-foreground break-words">{detail}</div>}
      </div>
      <span className="text-muted-foreground whitespace-nowrap pt-0.5">{ago}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0"
        onClick={onDelete}
        disabled={deleting}
        aria-label="Delete entry"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function StatusIcon({ entry }: Readonly<{ entry: NotificationLogEntry }>) {
  if (entry.status === 'success') {
    return <CheckCircle2 className="h-4 w-4 text-success mt-0.5" />;
  }
  if (entry.status === 'failed') {
    return <XCircle className="h-4 w-4 text-danger mt-0.5" />;
  }
  return <SkipForward className="h-4 w-4 text-muted-foreground mt-0.5" />;
}

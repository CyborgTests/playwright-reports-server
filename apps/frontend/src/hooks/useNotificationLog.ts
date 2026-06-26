import type { NotificationLogEntry } from '@playwright-reports/shared';
import useQuery from './useQuery';

export interface NotificationLogQuery {
  channelId?: string;
  status?: 'success' | 'failed' | 'skipped';
  limit?: number;
  offset?: number;
}

export interface NotificationLogResponse {
  rows: NotificationLogEntry[];
  total: number;
  last24h: { success: number; failed: number; skipped: number };
}

function buildPath(filters: NotificationLogQuery): string {
  const params = new URLSearchParams();
  if (filters.channelId) params.set('channelId', filters.channelId);
  if (filters.status) params.set('status', filters.status);
  params.set('limit', String(filters.limit ?? 50));
  params.set('offset', String(filters.offset ?? 0));
  return `/api/notifications/log?${params.toString()}`;
}

export function useNotificationLog(filters: NotificationLogQuery, options?: { enabled?: boolean }) {
  return useQuery<NotificationLogResponse, { success: boolean; data: NotificationLogResponse }>(
    buildPath(filters),
    {
      queryKey: ['notifications', 'log', filters],
      enabled: options?.enabled,
      refetchInterval: 10_000,
      select: (envelope) => envelope.data,
    }
  );
}

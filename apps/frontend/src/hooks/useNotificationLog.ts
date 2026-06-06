import type { NotificationLogEntry } from '@playwright-reports/shared';
import { useQuery } from '@tanstack/react-query';
import { authHeaders } from '../lib/auth';
import { withBase } from '../lib/url';
import { useAuth } from './useAuth';
import { useUnauthorizedRedirect } from './useUnauthorizedRedirect';

export interface NotificationLogQuery {
  channelId?: string;
  status?: 'success' | 'failed' | 'skipped';
  source?: 'live' | 'test';
  limit?: number;
  offset?: number;
}

export interface NotificationLogResponse {
  rows: NotificationLogEntry[];
  total: number;
  last24h: { success: number; failed: number; skipped: number };
}

function buildUrl(filters: NotificationLogQuery): string {
  const params = new URLSearchParams();
  if (filters.channelId) params.set('channelId', filters.channelId);
  if (filters.status) params.set('status', filters.status);
  if (filters.source) params.set('source', filters.source);
  params.set('limit', String(filters.limit ?? 50));
  params.set('offset', String(filters.offset ?? 0));
  return withBase(`/api/notifications/log?${params.toString()}`);
}

export function useNotificationLog(filters: NotificationLogQuery, options?: { enabled?: boolean }) {
  useUnauthorizedRedirect();
  const session = useAuth();
  const authReady = session.status === 'authenticated';
  const enabled = authReady && (options?.enabled ?? true);

  return useQuery<NotificationLogResponse>({
    queryKey: ['notifications', 'log', filters],
    queryFn: async () => {
      const res = await fetch(buildUrl(filters), { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to fetch delivery log (${res.status})`);
      const body = (await res.json()) as { success: boolean; data: NotificationLogResponse };
      return body.data;
    },
    enabled,
    refetchInterval: 10_000,
  });
}

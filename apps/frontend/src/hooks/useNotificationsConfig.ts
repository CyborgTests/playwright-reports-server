import type { NotificationsConfig } from '@playwright-reports/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { authHeaders } from '../lib/auth';
import { withBase } from '../lib/url';
import { useAuth } from './useAuth';
import { useUnauthorizedRedirect } from './useUnauthorizedRedirect';

export const NOTIFICATIONS_QUERY_KEY = ['config', 'notifications'] as const;

const EMPTY: NotificationsConfig = { enabled: false, channels: [] };

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  issues?: Array<{ message?: string }>;
}

export function useNotificationsConfig() {
  useUnauthorizedRedirect();
  const session = useAuth();
  const isAuthDisabled = session.status === 'authenticated' && session.data === null;
  const enabled = isAuthDisabled || session.status === 'authenticated';

  return useQuery<NotificationsConfig>({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch(withBase('/api/config/notifications'), { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to fetch notifications config (${res.status})`);
      const body = (await res.json()) as ApiEnvelope<NotificationsConfig>;
      return body.data ?? EMPTY;
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useUpdateNotificationsConfig() {
  const queryClient = useQueryClient();

  return useMutation<NotificationsConfig, Error, NotificationsConfig>({
    mutationFn: async (config) => {
      const res = await fetch(withBase('/api/config/notifications'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(config),
      });
      const text = await res.text();
      if (!res.ok) {
        let detail = text;
        try {
          const parsed = JSON.parse(text) as ApiEnvelope<unknown>;
          if (parsed.issues && Array.isArray(parsed.issues) && parsed.issues.length > 0) {
            detail = parsed.issues
              .map((i) =>
                i && typeof i === 'object' && 'message' in i
                  ? (i as { message: string }).message
                  : JSON.stringify(i)
              )
              .join(' · ');
          } else if (parsed.error) {
            detail = parsed.error;
          }
        } catch {
          /* keep raw text */
        }
        throw new Error(detail);
      }
      const body = JSON.parse(text) as ApiEnvelope<NotificationsConfig>;
      return body.data ?? EMPTY;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(NOTIFICATIONS_QUERY_KEY, data);
      toast.success('Notifications saved');
    },
    onError: (err) => {
      toast.error(`Save failed: ${err.message}`);
    },
  });
}

import type { NotificationsConfig } from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import appUseMutation from './useMutation';
import appUseQuery from './useQuery';
import { useUnauthorizedRedirect } from './useUnauthorizedRedirect';

export const NOTIFICATIONS_QUERY_KEY = ['config', 'notifications'] as const;

const EMPTY: NotificationsConfig = { enabled: false, channels: [] };

interface NotificationsEnvelope {
  data?: NotificationsConfig;
}

export function useNotificationsConfig() {
  useUnauthorizedRedirect();
  return appUseQuery<NotificationsConfig, NotificationsEnvelope>('/api/config/notifications', {
    queryKey: NOTIFICATIONS_QUERY_KEY,
    select: (body) => body.data ?? EMPTY,
    staleTime: 30_000,
  });
}

export function useUpdateNotificationsConfig() {
  const queryClient = useQueryClient();
  return appUseMutation<NotificationsEnvelope, NotificationsConfig>('/api/config/notifications', {
    method: 'PUT',
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY });
      toast.success('Notifications saved');
    },
  });
}

import type {
  QualityDashboard,
  QualityDashboardConfig,
  QualityDashboardSnapshot,
  QualityDashboardSummary,
  QualityNode,
  QualityNodeInput,
} from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useAuth } from './useAuth';
import useMutation from './useMutation';
import useQuery from './useQuery';
import { useUnauthorizedRedirect } from './useUnauthorizedRedirect';

const QUALITY_KEY = ['quality'] as const;
const DASHBOARDS_KEY = ['quality', 'dashboards'] as const;
const PROJECTS_KEY = ['quality', 'projects'] as const;
const HOME_KEY = ['quality', 'home'] as const;
const dashboardConfigKey = (slug: string) => ['quality', 'dashboard', slug] as const;
const dashboardSnapshotKey = (slug: string) => ['quality', 'snapshot', slug] as const;

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

function useAuthEnabled() {
  useUnauthorizedRedirect();
  const session = useAuth();
  const isAuthDisabled = session.status === 'authenticated' && session.data === null;
  return isAuthDisabled || session.status === 'authenticated';
}

export function useQualityDashboardList() {
  const enabled = useAuthEnabled();
  return useQuery<QualityDashboardSummary[], ApiEnvelope<QualityDashboardSummary[]>>(
    '/api/quality/dashboards',
    {
      queryKey: DASHBOARDS_KEY,
      enabled,
      staleTime: 60_000,
      select: (envelope) => envelope.data ?? [],
    }
  );
}

export function useQualityDashboardConfig(slug: string | undefined) {
  const enabled = useAuthEnabled() && !!slug;
  return useQuery<QualityDashboardConfig, ApiEnvelope<QualityDashboardConfig>>(
    `/api/quality/dashboards/${slug}`,
    {
      queryKey: dashboardConfigKey(slug ?? ''),
      enabled,
      staleTime: 30_000,
      select: (envelope) => envelope.data as QualityDashboardConfig,
    }
  );
}

export function useQualityDashboardSnapshot(slug: string | undefined) {
  const enabled = useAuthEnabled() && !!slug;
  return useQuery<QualityDashboardSnapshot, ApiEnvelope<QualityDashboardSnapshot>>(
    `/api/quality/dashboards/${slug}/snapshot`,
    {
      queryKey: dashboardSnapshotKey(slug ?? ''),
      enabled,
      staleTime: 30_000,
      select: (envelope) => envelope.data as QualityDashboardSnapshot,
    }
  );
}

export function useQualityProjects(active = true) {
  const authEnabled = useAuthEnabled();
  return useQuery<string[], ApiEnvelope<string[]>>('/api/quality/projects', {
    queryKey: PROJECTS_KEY,
    enabled: authEnabled && active,
    staleTime: 60_000,
    select: (envelope) => envelope.data ?? [],
  });
}

export function useQualityHomeSnapshots() {
  const enabled = useAuthEnabled();
  return useQuery<QualityDashboardSnapshot[], ApiEnvelope<QualityDashboardSnapshot[]>>(
    '/api/quality/home',
    {
      queryKey: HOME_KEY,
      enabled,
      staleTime: 30_000,
      select: (envelope) => envelope.data ?? [],
    }
  );
}

interface ReorderContext {
  previous?: QualityDashboardSnapshot[];
}

export function useReorderHome() {
  const queryClient = useQueryClient();
  return useMutation<ApiEnvelope<QualityDashboard[]>, { orderedIds: string[] }, ReorderContext>(
    '/api/quality/home/order',
    {
      method: 'PUT',
      silent: true,
      onMutate: async ({ body }) => {
        const orderedIds = body?.orderedIds ?? [];
        await queryClient.cancelQueries({ queryKey: HOME_KEY });
        const previous = queryClient.getQueryData<QualityDashboardSnapshot[]>(HOME_KEY);
        if (previous) {
          const byId = new Map(previous.map((snapshot) => [snapshot.dashboard.id, snapshot]));
          const next: QualityDashboardSnapshot[] = [];
          const seen = new Set<string>();
          for (const id of orderedIds) {
            const snapshot = byId.get(id);
            if (snapshot) {
              next.push(snapshot);
              seen.add(id);
            }
          }
          for (const snapshot of previous) {
            if (!seen.has(snapshot.dashboard.id)) next.push(snapshot);
          }
          queryClient.setQueryData(HOME_KEY, next);
        }
        return { previous };
      },
      onError: (error, _variables, context) => {
        if (context?.previous) queryClient.setQueryData(HOME_KEY, context.previous);
        toast.error(error.message);
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: QUALITY_KEY }),
    }
  );
}

export interface DashboardCreateInput {
  name: string;
  isDefault?: boolean;
  stalenessDays?: number;
}

export function useCreateDashboard() {
  const queryClient = useQueryClient();
  return useMutation<ApiEnvelope<QualityDashboard>, DashboardCreateInput>(
    '/api/quality/dashboards',
    {
      method: 'POST',
      silent: true,
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: QUALITY_KEY });
        toast.success('Dashboard created');
      },
    }
  );
}

export type DashboardPatch = Partial<Omit<QualityDashboard, 'id' | 'createdAt' | 'updatedAt'>>;

export function useUpdateDashboard() {
  const queryClient = useQueryClient();
  return useMutation<ApiEnvelope<QualityDashboard>, DashboardPatch>('/api/quality/dashboards', {
    method: 'PATCH',
    silent: true,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUALITY_KEY }),
    onError: (error) => toast.error(error.message),
  });
}

export function useDeleteDashboard() {
  const queryClient = useQueryClient();
  return useMutation('/api/quality/dashboards', {
    method: 'DELETE',
    silent: true,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUALITY_KEY });
      toast.success('Dashboard deleted');
    },
    onError: (error) => toast.error(error.message),
  });
}

export function useSaveDashboardTree() {
  const queryClient = useQueryClient();
  return useMutation<ApiEnvelope<{ nodes: QualityNode[] }>, { nodes: QualityNodeInput[] }>(
    '/api/quality/dashboards',
    {
      method: 'PUT',
      silent: true,
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: QUALITY_KEY });
        toast.success('Dashboard saved');
      },
      onError: (error) => toast.error(error.message),
    }
  );
}

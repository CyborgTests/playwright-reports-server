import type {
  QualityDashboard,
  QualityDashboardConfig,
  QualityDashboardSnapshot,
  QualityDashboardSummary,
  QualityNode,
  QualityNodeInput,
} from '@playwright-reports/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { authHeaders } from '../lib/auth';
import { withBase } from '../lib/url';
import { useAuth } from './useAuth';
import { useUnauthorizedRedirect } from './useUnauthorizedRedirect';

const QK_LIST = ['quality', 'dashboards'] as const;
const QK_CONFIG = (slug: string) => ['quality', 'dashboard', slug] as const;
const QK_SNAPSHOT = (slug: string) => ['quality', 'snapshot', slug] as const;
const QK_PROJECTS = ['quality', 'projects'] as const;
const QK_HOME = ['quality', 'home'] as const;

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  issues?: Array<{ message?: string; path?: Array<string | number> }>;
}

function describeError(envelope: ApiEnvelope<unknown> | undefined, fallback: string): string {
  if (!envelope) return fallback;
  if (envelope.error) {
    if (envelope.issues?.length) {
      const detail = envelope.issues
        .map((i) => i?.message || JSON.stringify(i))
        .filter(Boolean)
        .join('; ');
      return detail ? `${envelope.error}: ${detail}` : envelope.error;
    }
    return envelope.error;
  }
  return fallback;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(withBase(path), {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let envelope: ApiEnvelope<T> | undefined;
  try {
    envelope = text ? (JSON.parse(text) as ApiEnvelope<T>) : undefined;
  } catch {
    envelope = undefined;
  }
  if (!res.ok || envelope?.success === false) {
    const message = describeError(envelope, `Request failed (${res.status})`);
    throw new Error(message);
  }
  return envelope?.data as T;
}

function useAuthEnabled() {
  useUnauthorizedRedirect();
  const session = useAuth();
  const isAuthDisabled = session.status === 'authenticated' && session.data === null;
  return isAuthDisabled || session.status === 'authenticated';
}

export function useQualityDashboardList() {
  const enabled = useAuthEnabled();
  return useQuery<QualityDashboardSummary[]>({
    queryKey: QK_LIST,
    queryFn: () => apiFetch<QualityDashboardSummary[]>('/api/quality/dashboards'),
    enabled,
    staleTime: 60_000,
  });
}

export function useQualityDashboardConfig(slug: string | undefined) {
  const enabled = useAuthEnabled() && !!slug;
  return useQuery<QualityDashboardConfig>({
    queryKey: QK_CONFIG(slug ?? ''),
    queryFn: () => apiFetch<QualityDashboardConfig>(`/api/quality/dashboards/${slug}`),
    enabled,
    staleTime: 30_000,
  });
}

export function useQualityDashboardSnapshot(slug: string | undefined) {
  const enabled = useAuthEnabled() && !!slug;
  return useQuery<QualityDashboardSnapshot>({
    queryKey: QK_SNAPSHOT(slug ?? ''),
    queryFn: () => apiFetch<QualityDashboardSnapshot>(`/api/quality/dashboards/${slug}/snapshot`),
    enabled,
    staleTime: 30_000,
  });
}

export function useQualityProjects() {
  const enabled = useAuthEnabled();
  return useQuery<string[]>({
    queryKey: QK_PROJECTS,
    queryFn: () => apiFetch<string[]>('/api/quality/projects'),
    enabled,
    staleTime: 60_000,
  });
}

export function useQualityHomeSnapshots() {
  const enabled = useAuthEnabled();
  return useQuery<QualityDashboardSnapshot[]>({
    queryKey: QK_HOME,
    queryFn: () => apiFetch<QualityDashboardSnapshot[]>('/api/quality/home'),
    enabled,
    staleTime: 30_000,
  });
}

interface ReorderContext {
  previous?: QualityDashboardSnapshot[];
}

export function useReorderHome() {
  const qc = useQueryClient();
  return useMutation<QualityDashboard[], Error, string[], ReorderContext>({
    mutationFn: (orderedIds) =>
      apiFetch<QualityDashboard[]>('/api/quality/home/order', {
        method: 'PUT',
        body: JSON.stringify({ orderedIds }),
      }),
    onMutate: async (orderedIds) => {
      await qc.cancelQueries({ queryKey: QK_HOME });
      const previous = qc.getQueryData<QualityDashboardSnapshot[]>(QK_HOME);
      if (previous) {
        const byId = new Map(previous.map((p) => [p.dashboard.id, p]));
        const next: QualityDashboardSnapshot[] = [];
        const seen = new Set<string>();
        for (const id of orderedIds) {
          const snap = byId.get(id);
          if (snap) {
            next.push(snap);
            seen.add(id);
          }
        }
        for (const p of previous) if (!seen.has(p.dashboard.id)) next.push(p);
        qc.setQueryData(QK_HOME, next);
      }
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(QK_HOME, ctx.previous);
      toast.error(err.message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['quality'] });
    },
  });
}

export interface DashboardCreateInput {
  name: string;
  isDefault?: boolean;
  stalenessDays?: number;
}

export function useCreateDashboard() {
  const qc = useQueryClient();
  return useMutation<QualityDashboard, Error, DashboardCreateInput>({
    mutationFn: (input) =>
      apiFetch<QualityDashboard>('/api/quality/dashboards', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quality'] });
      toast.success('Dashboard created');
    },
  });
}

export interface DashboardUpdatePayload {
  id: string;
  patch: Partial<Omit<QualityDashboard, 'id' | 'createdAt' | 'updatedAt'>>;
}

export function useUpdateDashboard() {
  const qc = useQueryClient();
  return useMutation<QualityDashboard, Error, DashboardUpdatePayload>({
    mutationFn: ({ id, patch }) =>
      apiFetch<QualityDashboard>(`/api/quality/dashboards/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quality'] });
    },
    onError: (err) => toast.error(err.message),
  });
}

export function useDeleteDashboard() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) =>
      apiFetch<void>(`/api/quality/dashboards/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quality'] });
      toast.success('Dashboard deleted');
    },
    onError: (err) => toast.error(err.message),
  });
}

export interface SaveTreePayload {
  id: string;
  nodes: QualityNodeInput[];
}

export function useSaveDashboardTree() {
  const qc = useQueryClient();
  return useMutation<{ nodes: QualityNode[] }, Error, SaveTreePayload>({
    mutationFn: ({ id, nodes }) =>
      apiFetch<{ nodes: QualityNode[] }>(`/api/quality/dashboards/${id}/tree`, {
        method: 'PUT',
        body: JSON.stringify({ nodes }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quality'] });
      toast.success('Dashboard saved');
    },
    onError: (err) => toast.error(err.message),
  });
}

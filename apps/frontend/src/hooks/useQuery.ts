import { type UseQueryOptions, useQuery as useTanStackQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { extractResponseError } from '../lib/api';
import { withBase } from '../lib/url';
import { authHeadersForSession, useAuth } from './useAuth';

const UNAUTHORIZED_ERROR = 'Unauthorized';

const useQuery = <TData, TQueryFnData = TData>(
  path: string,
  options?: Omit<UseQueryOptions<TQueryFnData, Error, TData>, 'queryKey' | 'queryFn'> & {
    dependencies?: unknown[];
    queryKey?: readonly unknown[];
    method?: string;
    body?: BodyInit | null;
  }
) => {
  const session = useAuth();

  const authed = session.status === 'authenticated';
  const enabled = options?.enabled === undefined ? authed : options.enabled && authed;

  return useTanStackQuery<TQueryFnData, Error, TData>({
    queryKey: options?.queryKey ?? [path, ...(options?.dependencies ?? [])],
    queryFn: async () => {
      const headers = authHeadersForSession(session);

      const fullPath = withBase(path);
      const response = await fetch(fullPath, {
        headers,
        credentials: 'include',
        body: options?.body ? JSON.stringify(options.body) : undefined,
        method: options?.method ?? 'GET',
      });

      if (response.status === 401) {
        throw new Error(UNAUTHORIZED_ERROR);
      }

      if (!response.ok) {
        const message = extractResponseError(await response.text(), response.status);
        toast.error(message);
        throw new Error(message);
      }

      return response.json();
    },
    enabled,
    ...(options?.staleTime !== undefined && { staleTime: options.staleTime }),
    ...(options?.gcTime !== undefined && { gcTime: options.gcTime }),
    retry:
      options?.retry ??
      ((failureCount, error) => error.message !== UNAUTHORIZED_ERROR && failureCount < 3),
    ...(options?.select !== undefined && { select: options.select }),
    ...(options?.placeholderData !== undefined && { placeholderData: options.placeholderData }),
    ...(options?.refetchInterval !== undefined && { refetchInterval: options.refetchInterval }),
  });
};

export default useQuery;

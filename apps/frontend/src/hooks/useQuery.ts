import { type UseQueryOptions, useQuery as useTanStackQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { withBase } from '../lib/url';
import { authHeadersForSession, useAuth } from './useAuth';

const UNAUTHORIZED_ERROR = 'Unauthorized';

const useQuery = <ReturnType>(
  path: string,
  options?: Omit<UseQueryOptions<ReturnType, Error>, 'queryKey' | 'queryFn'> & {
    dependencies?: unknown[];
    method?: string;
    body?: BodyInit | null;
  }
) => {
  const session = useAuth();

  const isAuthDisabled = session.status === 'authenticated' && session.data === null;
  const enabled =
    options?.enabled === undefined
      ? isAuthDisabled || session.status === 'authenticated'
      : options.enabled && (isAuthDisabled || session.status === 'authenticated');

  return useTanStackQuery<ReturnType, Error>({
    queryKey: [path, ...(options?.dependencies ?? [])],
    queryFn: async () => {
      const headers = authHeadersForSession(session);

      const fullPath = withBase(path);
      const response = await fetch(fullPath, {
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
        method: options?.method ?? 'GET',
      });

      if (response.status === 401) {
        throw new Error(UNAUTHORIZED_ERROR);
      }

      if (!response.ok) {
        const errorBody = await response.text();
        toast.error(`Network response was not ok: ${errorBody}`);
        throw new Error(`Network response was not ok: ${errorBody}`);
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

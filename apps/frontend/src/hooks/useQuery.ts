import { type UseQueryOptions, useQuery as useTanStackQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { withQueryParams } from '../config/network';
import { withBase } from '../lib/url';
import { useAuth } from './useAuth';

const useQuery = <ReturnType>(
  path: string,
  options?: Omit<UseQueryOptions<ReturnType, Error>, 'queryKey' | 'queryFn'> & {
    dependencies?: unknown[];
    callback?: string;
    method?: string;
    body?: BodyInit | null;
  }
) => {
  const session = useAuth();
  const navigate = useNavigate();

  const callback = options?.callback;

  useEffect(() => {
    if (session.status === 'unauthenticated' && window.location.pathname !== '/login') {
      toast.warning('Unauthorized');
      navigate(
        withQueryParams(
          withBase('/login'),
          callback
            ? { callbackUrl: encodeURI(callback) }
            : { callbackUrl: encodeURI(withBase(window.location.pathname)) }
        )
      );
    }
  }, [session.status, navigate, callback]);

  const isAuthDisabled = session.status === 'authenticated' && session.data === null;
  const enabled =
    options?.enabled === undefined
      ? isAuthDisabled || session.status === 'authenticated'
      : options.enabled && (isAuthDisabled || session.status === 'authenticated');

  return useTanStackQuery<ReturnType, Error>({
    queryKey: [path, ...(options?.dependencies ?? [])],
    queryFn: async () => {
      const headers: HeadersInit = {};

      const jwtToken = typeof window !== 'undefined' ? localStorage.getItem('jwtToken') : null;
      if (jwtToken && session.status === 'authenticated' && session.data !== null) {
        headers.Authorization = `Bearer ${jwtToken}`;
      }

      const fullPath = withBase(path);
      const response = await fetch(fullPath, {
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
        method: options?.method ?? 'GET',
      });

      if (!response.ok && response.status !== 401) {
        toast.error(`Network response was not ok: ${await response.text()}`);
        throw new Error(`Network response was not ok: ${await response.text()}`);
      }

      return response.json();
    },
    enabled,
    ...(options?.staleTime !== undefined && { staleTime: options.staleTime }),
    ...(options?.gcTime !== undefined && { gcTime: options.gcTime }),
    ...(options?.retry !== undefined && { retry: options.retry }),
    ...(options?.select !== undefined && { select: options.select }),
    ...(options?.placeholderData !== undefined && { placeholderData: options.placeholderData }),
    ...(options?.refetchInterval !== undefined && { refetchInterval: options.refetchInterval }),
  });
};

export default useQuery;

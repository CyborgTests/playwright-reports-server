'use client';

import { useQuery as useTanStackQuery, UseQueryOptions } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { withQueryParams } from '../lib/network';
import { env } from '../config/env';

import { useAuthConfig } from './useAuthConfig';

const useQuery = <ReturnType>(
  path: string,
  options?: Omit<UseQueryOptions<ReturnType, Error>, 'queryKey' | 'queryFn'> & {
    dependencies?: unknown[];
    callback?: string;
    method?: string;
    body?: BodyInit | null;
  },
) => {
  const session = useSession();
  const router = useRouter();
  const { authRequired } = useAuthConfig();

  useEffect(() => {
    // Don't redirect if auth is not required
    if (authRequired === false) {
      return;
    }

    // Don't redirect if we haven't determined auth requirements yet
    if (authRequired === null) {
      return;
    }

    if (session.status === 'unauthenticated') {
      toast.warning('Unauthorized');
      router.push(
        withQueryParams(
          env.API_BASE_PATH + '/login',
          options?.callback
            ? { callbackUrl: encodeURI(options.callback) }
            : { callbackUrl: encodeURI(env.API_BASE_PATH) },
        ),
      );

      return;
    }

    if (session.status === 'loading') {
      return;
    }
  }, [session.status, authRequired]);

  return useTanStackQuery<ReturnType, Error>({
    queryKey: [path, ...(options?.dependencies ?? [])],
    queryFn: async () => {
      const headers: HeadersInit = {};

      if (session.data?.user?.apiToken) {
        headers.Authorization = session.data.user.apiToken;
      }

      const fullPath = env.API_BASE_PATH + path;
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
    enabled: authRequired === false || session.status === 'authenticated',
    ...options,
  });
};

export default useQuery;

'use client';

import { useQuery as useTanStackQuery, UseQueryOptions } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { withQueryParams } from '../lib/network';

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

  useEffect(() => {
    if (session.status === 'unauthenticated') {
      toast.warning('Unauthorized');
      router.push(withQueryParams('/login', options?.callback ? { callbackUrl: encodeURI(options.callback) } : {}));

      return;
    }

    if (session.status === 'loading') {
      return;
    }
  }, [session.status]);

  return useTanStackQuery<ReturnType, Error>({
    queryKey: [path, ...(options?.dependencies ?? [])],
    queryFn: async () => {
      const headers: HeadersInit = {};

      if (session.data?.user?.apiToken) {
        headers.Authorization = session.data.user.apiToken;
      }

      const response = await fetch(path, {
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
    enabled: session.status === 'authenticated',
    ...options,
  });
};

export default useQuery;

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

const useQuery = <ReturnType>(
  path: string,
  options?: RequestInit & { dependencies?: unknown[]; callback?: string },
) => {
  const [data, setData] = useState<ReturnType | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const session = useSession();
  const router = useRouter();

  const apiToken = useMemo(() => session?.data?.user?.apiToken, [session]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = !!apiToken
        ? {
            Authorization: apiToken,
          }
        : undefined;

      const response = await fetch(path, {
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
        method: options?.method ?? 'GET',
      });

      if (!response.ok) {
        throw new Error(`Network response was not ok: ${await response.text()}`);
      }
      const jsonData = await response.json();

      setData(jsonData);
    } catch (err) {
      if (err instanceof Error) {
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  }, [path, options, apiToken, ...(options?.dependencies ?? [])]);

  useEffect(() => {
    if (session.status === 'unauthenticated') {
      const redirectParam = options?.callback ? `?callbackUrl=${encodeURI(options.callback)}` : '';

      router.replace(`/login${redirectParam}`);

      return;
    }

    if (session.status === 'loading') {
      return;
    }

    fetchData();
  }, [session.status]);

  return { data, isLoading, error, refetch: fetchData };
};

export default useQuery;

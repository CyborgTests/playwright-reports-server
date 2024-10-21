'use client';

import { useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';

const useMutation = (url: string, options: RequestInit) => {
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const session = useSession();

  const apiToken = session?.data?.user?.apiToken;

  const mutate = useCallback(
    async (body?: unknown, opts?: { path: string }) => {
      setLoading(true);
      setError(null);

      try {
        const headers = !!apiToken
          ? {
              Authorization: apiToken,
            }
          : undefined;

        const response = await fetch(opts?.path ?? url, {
          headers,
          body: body ? JSON.stringify(body) : undefined,
          method: options?.method ?? 'GET',
        });

        if (!response.ok) {
          throw new Error(`Network response was not ok: ${await response.text()}`);
        }

        return await response.json();
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    },
    [url, options],
  );

  return { isLoading, error, mutate: mutate };
};

export default useMutation;

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useApiToken } from '@/app/providers/ApiTokenProvider';

const useMutation = (url: string, options: RequestInit) => {
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { apiToken, isClientAuthorized } = useApiToken();

  const router = useRouter();

  useEffect(() => {
    if (!isClientAuthorized()) {
      router.push('/login');
    }
  }, []);

  const mutate = useCallback(
    async (body?: unknown) => {
      setLoading(true);
      setError(null);

      try {
        const headers = !!apiToken
          ? {
              Authorization: apiToken,
            }
          : undefined;

        const response = await fetch(url, {
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

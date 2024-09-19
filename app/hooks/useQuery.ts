import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { useApiToken } from '@/app/providers/ApiTokenProvider';

const useQuery = <ReturnType>(path: string, options?: RequestInit) => {
  const [data, setData] = useState<ReturnType | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { apiToken, isClientAuthorized } = useApiToken();

  const router = useRouter();

  const fetchData = useCallback(async () => {
    // handle missing auth on refetch
    if (!isClientAuthorized()) {
      return;
    }

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
  }, [path, options]);

  useEffect(() => {
    if (!isClientAuthorized()) {
      router.replace('/login');

      return;
    }
    fetchData();
  }, []);

  return { data, isLoading, error, refetch: fetchData };
};

export default useQuery;

import { useState, useEffect, useCallback } from 'react';
import { redirect } from 'next/navigation';

import { useApiToken } from '@/app/providers/ApiTokenProvider';

const useQuery = <ReturnType>(url: string, options?: RequestInit) => {
  const [data, setData] = useState<ReturnType | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { apiToken, isRequiredAuth } = useApiToken();

  const fetchData = useCallback(async () => {
    if (isRequiredAuth && !apiToken) {
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

      const response = await fetch(url, {
        headers,
        body: options?.body ? JSON.stringify(options.body) : undefined,
        method: options?.method ?? 'GET',
      });

      if (!response.ok) {
        throw new Error('Network response was not ok');
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
  }, [url, options, apiToken]);

  useEffect(() => {
    if (isRequiredAuth && !apiToken) {
      redirect('/login');
    }

    fetchData();
  }, []);

  return { data, isLoading, error, refetch: fetchData };
};

export default useQuery;

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useSyncSearchParams(params: Record<string, string | null | undefined>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const serialized = JSON.stringify(params, (_key, value) => (value === undefined ? null : value));

  useEffect(() => {
    const desired = JSON.parse(serialized) as Record<string, string | null>;
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(desired)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [serialized, searchParams, setSearchParams]);
}

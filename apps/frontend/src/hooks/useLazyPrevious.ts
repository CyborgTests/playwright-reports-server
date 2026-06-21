import { useCallback, useMemo, useRef, useState } from 'react';

interface ScopedState<T> {
  scopeKey: string;
  previous: T[];
  exhausted: boolean;
}

export function useLazyPrevious<T>({
  initial,
  total,
  scopeKey,
  getKey,
  getCursor,
  fetchPage,
}: {
  initial: T[];
  total: number;
  scopeKey: string;
  getKey: (item: T) => string;
  getCursor: (item: T) => string;
  fetchPage: (before: string) => Promise<{ items: T[]; hasMore: boolean }>;
}) {
  const [state, setState] = useState<ScopedState<T>>({ scopeKey, previous: [], exhausted: false });
  const [isLoadingPrevious, setIsLoadingPrevious] = useState(false);
  const loadingRef = useRef(false);

  if (state.scopeKey !== scopeKey) {
    setState({ scopeKey, previous: [], exhausted: false });
  }
  const scopeMatches = state.scopeKey === scopeKey;
  const previous = scopeMatches ? state.previous : [];
  const exhausted = scopeMatches ? state.exhausted : false;

  const items = useMemo(() => {
    if (previous.length === 0) return initial;
    const seen = new Set(initial.map(getKey));
    const merged = [...initial];
    for (const it of previous) {
      const k = getKey(it);
      if (!seen.has(k)) {
        seen.add(k);
        merged.push(it);
      }
    }
    return merged;
  }, [initial, previous, getKey]);

  const hasMore = !exhausted && items.length < total;

  const loadPrevious = useCallback(async () => {
    if (loadingRef.current || exhausted) return;
    const oldest = items[items.length - 1];
    if (!oldest || items.length >= total) return;
    loadingRef.current = true;
    setIsLoadingPrevious(true);
    try {
      const page = await fetchPage(getCursor(oldest));
      const done = !page.hasMore || page.items.length === 0;
      setState((prev) =>
        prev.scopeKey === scopeKey
          ? { ...prev, previous: [...prev.previous, ...page.items], exhausted: done }
          : prev
      );
    } catch {
      // Leave `exhausted` false so a further scroll can retry.
    } finally {
      loadingRef.current = false;
      setIsLoadingPrevious(false);
    }
  }, [items, total, exhausted, scopeKey, fetchPage, getCursor]);

  return { items, loadPrevious, hasMore, isLoadingPrevious };
}

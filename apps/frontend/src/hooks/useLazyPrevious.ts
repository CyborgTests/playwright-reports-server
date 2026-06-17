import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  const [previous, setPrevious] = useState<T[]>([]);
  const [isLoadingPrevious, setIsLoadingPrevious] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const loadingRef = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed on scopeKey only
  useEffect(() => {
    setPrevious([]);
    setExhausted(false);
  }, [scopeKey]);

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
      setPrevious((prev) => [...prev, ...page.items]);
      if (!page.hasMore || page.items.length === 0) setExhausted(true);
    } catch {
      // Leave `exhausted` false so a further scroll can retry.
    } finally {
      loadingRef.current = false;
      setIsLoadingPrevious(false);
    }
  }, [items, total, exhausted, fetchPage, getCursor]);

  return { items, loadPrevious, hasMore, isLoadingPrevious };
}

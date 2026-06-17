import type { DateRange, RunHealthMetric } from '@playwright-reports/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authHeaders } from '../lib/auth';
import { withBase } from '../lib/url';

const PAGE_SIZE = 100;

interface RunHealthPageResponse {
  metrics: RunHealthMetric[];
  hasMore: boolean;
}

function buildUrl(
  project: string | undefined,
  dateRange: DateRange | undefined,
  failedOnly: boolean,
  before: string
): string {
  const params = new URLSearchParams();
  if (project) params.set('project', project);
  if (dateRange?.from) params.set('from', dateRange.from);
  if (dateRange?.to) params.set('to', dateRange.to);
  if (failedOnly) params.set('failedOnly', 'true');
  params.set('before', before);
  params.set('limit', String(PAGE_SIZE));
  return withBase(`/api/analytics/run-health?${params.toString()}`);
}

export function useRunHealthLazy(
  project: string | undefined,
  dateRange: DateRange | undefined,
  failedOnly: boolean,
  initialMetrics: RunHealthMetric[],
  totalRuns: number
) {
  const [previous, setPrevious] = useState<RunHealthMetric[]>([]);
  const [isLoadingPrevious, setIsLoadingPrevious] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const loadingRef = useRef(false);

  const from = dateRange?.from;
  const to = dateRange?.to;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed on scope primitives only
  useEffect(() => {
    setPrevious([]);
    setExhausted(false);
  }, [project, from, to, failedOnly]);

  const metrics = useMemo(() => {
    if (previous.length === 0) return initialMetrics;
    const seen = new Set(initialMetrics.map((m) => m.runId));
    const merged = [...initialMetrics];
    for (const m of previous) {
      if (!seen.has(m.runId)) {
        seen.add(m.runId);
        merged.push(m);
      }
    }
    return merged;
  }, [initialMetrics, previous]);

  const hasMore = !exhausted && metrics.length < totalRuns;

  const loadPrevious = useCallback(async () => {
    if (loadingRef.current || exhausted) return;
    const oldest = metrics[metrics.length - 1];
    if (!oldest || metrics.length >= totalRuns) return;
    loadingRef.current = true;
    setIsLoadingPrevious(true);
    try {
      const before = new Date(oldest.timestamp).toISOString();
      const res = await fetch(buildUrl(project, dateRange, failedOnly, before), {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Failed to load previous runs (${res.status})`);
      const body = (await res.json()) as { success: boolean; data: RunHealthPageResponse };
      const page = body.data;
      setPrevious((prev) => [...prev, ...page.metrics]);
      if (!page.hasMore || page.metrics.length === 0) setExhausted(true);
    } catch {
      // leave `exhausted` false so a further scroll can retry.
    } finally {
      loadingRef.current = false;
      setIsLoadingPrevious(false);
    }
  }, [project, dateRange, failedOnly, metrics, exhausted, totalRuns]);

  return { metrics, loadPrevious, hasMore, isLoadingPrevious };
}

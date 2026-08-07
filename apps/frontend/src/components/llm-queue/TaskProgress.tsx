import type { LlmDurationEstimate } from '@playwright-reports/shared';
import { formatDuration, parseSqliteTimestamp } from '@playwright-reports/shared';
import { useEffect, useState } from 'react';
import { Progress } from '@/components/ui/progress';
import { useTimeUntil } from '@/hooks/useTimeUntil';

function useTicker(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function TaskProgress({
  startedAt,
  estimate,
  etaFinishAt,
}: Readonly<{
  startedAt?: string;
  estimate?: LlmDurationEstimate;
  etaFinishAt?: string | null;
}>) {
  const now = useTicker();
  const countdown = useTimeUntil(etaFinishAt);

  const elapsedMs = startedAt ? Math.max(0, now - parseSqliteTimestamp(startedAt)) : 0;
  const remainingMs = countdown ?? (estimate ? estimate.meanMs - elapsedMs : null);

  if (!startedAt && countdown == null) return <span className="text-muted-foreground">…</span>;
  if (!estimate && countdown == null) {
    return <span className="tabular-nums text-muted-foreground">{formatDuration(elapsedMs)}</span>;
  }

  const pct = estimate ? Math.min((elapsedMs / estimate.meanMs) * 100, 99) : null;
  const leftLabel =
    remainingMs != null && remainingMs > 0 ? `~${formatDuration(remainingMs)} left` : 'finishing…';
  const title = estimate
    ? `elapsed ${formatDuration(elapsedMs)} · ~${formatDuration(estimate.meanMs)} typical (mean of ${estimate.sampleCount} runs)`
    : 'estimated from queue position and concurrency';

  return (
    <div className="flex min-w-[72px] flex-col gap-1" title={title}>
      {pct != null && <Progress value={pct} className="h-1.5" />}
      <span className="text-xs tabular-nums text-muted-foreground">{leftLabel}</span>
    </div>
  );
}

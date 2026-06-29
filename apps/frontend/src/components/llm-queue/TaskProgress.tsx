import type { LlmDurationEstimate } from '@playwright-reports/shared';
import { formatDuration, parseSqliteTimestamp } from '@playwright-reports/shared';
import { useEffect, useState } from 'react';
import { Progress } from '@/components/ui/progress';

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
}: Readonly<{
  startedAt?: string;
  estimate?: LlmDurationEstimate;
}>) {
  const now = useTicker();
  if (!startedAt) return <span className="text-muted-foreground">…</span>;

  const elapsedMs = Math.max(0, now - parseSqliteTimestamp(startedAt));
  if (!estimate) {
    return <span className="tabular-nums text-muted-foreground">{formatDuration(elapsedMs)}</span>;
  }

  const pct = Math.min((elapsedMs / estimate.meanMs) * 100, 99);
  const remainingMs = estimate.meanMs - elapsedMs;
  return (
    <div
      className="flex min-w-[72px] flex-col gap-1"
      title={`elapsed ${formatDuration(elapsedMs)} · ~${formatDuration(estimate.meanMs)} typical (mean of ${estimate.sampleCount} runs)`}
    >
      <Progress value={pct} className="h-1.5" />
      <span className="text-xs tabular-nums text-muted-foreground">
        {remainingMs > 0 ? `~${formatDuration(remainingMs)} left` : 'finishing…'}
      </span>
    </div>
  );
}

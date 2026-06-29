import { formatDuration, type LlmCircuitStatus } from '@playwright-reports/shared';
import { AlertTriangle } from 'lucide-react';
import { useCountdown } from '@/hooks/useCountdown';

export function CircuitBanner({ circuit }: Readonly<{ circuit?: LlmCircuitStatus }>) {
  const retryInMs = useCountdown(circuit?.state === 'open' ? circuit.retryInMs : null);
  if (!circuit || circuit.state === 'closed') return null;

  const message =
    circuit.state === 'half-open'
      ? 'LLM provider recovering…'
      : `LLM provider unavailable - retrying ${
          retryInMs && retryInMs > 0 ? `in ~${formatDuration(retryInMs)}` : 'shortly'
        }.`;

  return (
    <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

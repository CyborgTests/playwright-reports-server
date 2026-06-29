import { useEffect, useState } from 'react';

export function useCountdown(targetMs: number | null | undefined): number | null {
  const [remaining, setRemaining] = useState<number | null>(targetMs ?? null);
  useEffect(() => {
    if (targetMs == null) {
      setRemaining(null);
      return;
    }
    const anchor = Date.now();
    setRemaining(targetMs);
    const id = setInterval(() => {
      setRemaining(Math.max(0, targetMs - (Date.now() - anchor)));
    }, 1000);
    return () => clearInterval(id);
  }, [targetMs]);
  return remaining;
}

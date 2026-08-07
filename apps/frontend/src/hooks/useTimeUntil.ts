import { useEffect, useState } from 'react';

export function useTimeUntil(instant: string | null | undefined): number | null {
  const targetMs = instant ? Date.parse(instant) : Number.NaN;
  const valid = Number.isFinite(targetMs);
  const [remaining, setRemaining] = useState<number | null>(
    valid ? Math.max(0, targetMs - Date.now()) : null
  );

  useEffect(() => {
    if (!valid) {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(Math.max(0, targetMs - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetMs, valid]);

  return remaining;
}

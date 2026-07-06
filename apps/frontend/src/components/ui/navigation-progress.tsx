import { useIsFetching } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';

const MIN_VISIBLE_MS = 350;
const FINISH_FADE_MS = 200;

export function NavigationProgress() {
  const location = useLocation();
  const isFetching = useIsFetching();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const startedAtRef = useRef<number | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is used as a trigger to re-run on every route change, not read inside the effect.
  useEffect(() => {
    startedAtRef.current = Date.now();
    setVisible(true);
    setProgress(20);
    const t1 = window.setTimeout(() => setProgress(60), 150);
    const t2 = window.setTimeout(() => setProgress(85), 600);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [location.pathname]);

  useEffect(() => {
    if (!visible) return;
    if (isFetching > 0) return;
    const startedAt = startedAtRef.current;
    if (startedAt === null) return;
    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt));
    const finishT = window.setTimeout(() => {
      setProgress(100);
      const hideT = window.setTimeout(() => {
        setVisible(false);
        setProgress(0);
        startedAtRef.current = null;
      }, FINISH_FADE_MS);
      return () => window.clearTimeout(hideT);
    }, wait);
    return () => window.clearTimeout(finishT);
  }, [visible, isFetching]);

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden transition-opacity duration-200',
        visible ? 'opacity-100' : 'opacity-0'
      )}
    >
      <div
        className="h-full bg-primary shadow-[0_0_8px_hsl(var(--primary))] transition-[width] duration-300 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

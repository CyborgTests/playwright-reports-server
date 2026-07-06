import type { TestRun } from '@playwright-reports/shared';

export const exponentialMovingAverageDuration = (runs?: TestRun[]): number => {
  if (!runs || runs.length === 0) return 0;

  const alpha = 0.4; // smoothing factor (higher = more weight on recent values)
  let ema = runs.at(-1)?.duration ?? 0;

  for (let i = runs.length - 2; i >= 0; i--) {
    const duration = runs[i]?.duration || 0;
    ema = alpha * duration + (1 - alpha) * ema;
  }

  return Number(ema.toFixed(2));
};

import { FLAKINESS_THRESHOLDS, ReportTestOutcomeEnum } from '@playwright-reports/shared';

export function computeFlakinessFromOutcomes(
  runs: Array<{ outcome: ReportTestOutcomeEnum | string }>,
  minRuns: number = FLAKINESS_THRESHOLDS.MIN_RUNS
): number {
  if (runs.length < minRuns || runs.length <= 1) return 0;

  const isPass = (outcome: string): boolean =>
    outcome === ReportTestOutcomeEnum.Expected || outcome === 'passed';

  let events = 0;
  let inFailStreak = false;
  let seenPass = false;

  for (const { outcome } of runs) {
    if (isPass(outcome)) {
      if (inFailStreak) events++;
      seenPass = true;
      inFailStreak = false;
      continue;
    }

    if (outcome === ReportTestOutcomeEnum.Flaky) {
      if (inFailStreak) events++;
      events++;
      seenPass = true;
      inFailStreak = false;
      continue;
    }

    if (seenPass && !inFailStreak) inFailStreak = true;
  }

  return (events / runs.length) * 100;
}

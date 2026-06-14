import { ReportTestOutcomeEnum } from '@playwright-reports/shared';

export function computeFlakinessFromOutcomes(
  runs: Array<{ outcome: ReportTestOutcomeEnum | string }>,
  minRuns = 1
): number {
  if (runs.length < minRuns || runs.length <= 1) return 0;

  const isPass = (outcome: string): boolean =>
    outcome === ReportTestOutcomeEnum.Expected || outcome === 'passed';

  let events = 0;
  let inFailStreak = false;
  let seenPass = false;

  for (const { outcome } of runs) {
    if (outcome === ReportTestOutcomeEnum.Flaky) {
      events++;
      seenPass = true;
      inFailStreak = false;
      continue;
    }

    if (isPass(outcome)) {
      seenPass = true;
      inFailStreak = false;
    } else if (seenPass && !inFailStreak) {
      events++;
      inFailStreak = true;
    }
  }

  return (events / runs.length) * 100;
}

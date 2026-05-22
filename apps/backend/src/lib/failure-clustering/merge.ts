import type { ClusterStrategy, FailureCluster } from '@playwright-reports/shared';

const STRATEGY_PRECEDENCE: Record<ClusterStrategy, number> = {
  signature: 4,
  'stack-frame': 3,
  fixture: 2,
  temporal: 1,
};

const testKeyOf = (t: { project: string; fileId: string; testId: string }): string =>
  `${t.project}::${t.fileId}::${t.testId}`;

/**
 * Merge clusters from multiple strategies. When two clusters cover overlapping
 * test sets, the higher-precedence strategy wins; the lower one's strategy is
 * folded into the winner's `secondaryEvidence` as a `{strategy, count}` entry
 * (counts increment on repeat folds — never duplicate badges). Each shared
 * test's `matchedOn` list is unioned so the UI can show which signals pointed
 * at it. With a single strategy this is a no-op.
 *
 * Overlap rule: ≥ 50% of the smaller cluster's tests appear in the larger one.
 */
export function mergeClusters(clusters: FailureCluster[]): FailureCluster[] {
  if (clusters.length <= 1) return clusters;

  const sorted = [...clusters].sort(
    (a, b) =>
      STRATEGY_PRECEDENCE[b.strategy] - STRATEGY_PRECEDENCE[a.strategy] || b.testCount - a.testCount
  );

  const winners: FailureCluster[] = [];
  const winnerTestSets: Array<Set<string>> = [];

  for (const candidate of sorted) {
    const candidateKeys = new Set(candidate.tests.map(testKeyOf));

    const overlapIndex = winnerTestSets.findIndex((winnerSet) => {
      const smaller = Math.min(winnerSet.size, candidateKeys.size);
      if (smaller === 0) return false;
      let shared = 0;
      for (const k of candidateKeys) {
        if (winnerSet.has(k)) shared++;
      }
      return shared / smaller >= 0.5;
    });

    if (overlapIndex === -1) {
      winners.push(candidate);
      winnerTestSets.push(candidateKeys);
    } else {
      const winner = winners[overlapIndex];
      bumpSecondaryEvidence(winner, candidate.strategy);
      unionMatchedOn(winner, candidate);
    }
  }

  return winners;
}

function bumpSecondaryEvidence(winner: FailureCluster, strategy: ClusterStrategy): void {
  const list = winner.evidence.secondaryEvidence ?? [];
  const existing = list.find((e) => e.strategy === strategy);
  if (existing) {
    existing.count++;
  } else {
    list.push({ strategy, count: 1 });
  }
  winner.evidence.secondaryEvidence = list;
}

function unionMatchedOn(winner: FailureCluster, loser: FailureCluster): void {
  const winnerByKey = new Map(winner.tests.map((t) => [testKeyOf(t), t]));
  for (const loserTest of loser.tests) {
    const winnerTest = winnerByKey.get(testKeyOf(loserTest));
    if (!winnerTest) continue;
    for (const m of loserTest.matchedOn) {
      if (!winnerTest.matchedOn.includes(m)) winnerTest.matchedOn.push(m);
    }
  }
}

import type { ClusterStrategy, FailureCluster } from '@playwright-reports/shared';

const STRATEGY_PRECEDENCE: Record<ClusterStrategy, number> = {
  signature: 4,
  'stack-frame': 3,
  fixture: 2,
  temporal: 1,
};

/**
 * Merge clusters from multiple strategies. When two clusters cover overlapping
 * test sets, the higher-precedence strategy wins; the lower one is folded into
 * the winner's `secondaryEvidence`. With a single strategy this is a no-op.
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
    const candidateKeys = new Set(
      candidate.tests.map((t) => `${t.project}::${t.fileId}::${t.testId}`)
    );

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
      winner.evidence.secondaryEvidence = [
        ...(winner.evidence.secondaryEvidence ?? []),
        candidate.strategy,
      ];
    }
  }

  return winners;
}

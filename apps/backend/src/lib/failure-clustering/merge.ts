import type { ClusterStrategy, FailureCluster } from '@playwright-reports/shared';

/** Tiebreaker only — used when two overlapping clusters cover the same number
 *  of tests. Subsumption itself is decided by size (testCount); strategy just
 *  picks the most actionable anchor when sizes are equal. Stack-frame and
 *  fixture point at concrete code locations, so they win over signature
 *  (which over-splits when many tests fail with the same generic message) and
 *  temporal (the weakest co-occurrence signal). */
const STRATEGY_PRECEDENCE: Record<ClusterStrategy, number> = {
  'stack-frame': 4,
  fixture: 3,
  signature: 2,
  temporal: 1,
};

const testKeyOf = (t: { project: string; fileId: string; testId: string }): string =>
  `${t.project}::${t.fileId}::${t.testId}`;

/**
 * Merge clusters from multiple strategies. When two clusters cover overlapping
 * test sets, the LARGER cluster wins (by testCount); strategy precedence is
 * only the tiebreaker. The loser is folded into the winner as both:
 *  - a `secondaryEvidence` entry (compact `{strategy, count}` badge data), and
 *  - a `variants` entry (full name/sampleMessage/counts so the UI can show
 *    the original error groupings as nested rows inside the parent card).
 * Each shared test's `matchedOn` list is unioned so the per-test view still
 * shows every strategy that pointed at it.
 *
 * Subsumption-by-size means a 20-test stack-frame cluster wins over a 9-test
 * signature cluster that overlaps it — the previous strategy-first ordering
 * surfaced many small signature clusters and buried the big structural ones.
 *
 * Overlap rule: ≥ 50% of the smaller cluster's tests appear in the larger one.
 */
export function mergeClusters(clusters: FailureCluster[]): FailureCluster[] {
  if (clusters.length <= 1) return clusters;

  const sorted = [...clusters].sort(
    (a, b) =>
      b.testCount - a.testCount ||
      STRATEGY_PRECEDENCE[b.strategy] - STRATEGY_PRECEDENCE[a.strategy]
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
      addVariant(winner, candidate);
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

function addVariant(winner: FailureCluster, loser: FailureCluster): void {
  const variants = winner.variants ?? [];
  variants.push({
    id: loser.id,
    strategy: loser.strategy,
    name: loser.name,
    sampleMessage: loser.sampleMessage,
    testCount: loser.testCount,
    failureCount: loser.failureCount,
    evidence: loser.evidence,
  });
  winner.variants = variants;
}

import type { ClusterStrategy, FailureCluster } from '@playwright-reports/shared';

const ANCHORED_STRATEGIES: ReadonlySet<ClusterStrategy> = new Set(['stack-frame', 'fixture']);

const STRATEGY_PRECEDENCE: Record<ClusterStrategy, number> = {
  'stack-frame': 5,
  fixture: 4,
  selector: 3,
  signature: 2,
  temporal: 1,
  unclustered: 0,
};

const OVERLAP_THRESHOLD_ANCHORED_WINS = 0.3;
const OVERLAP_THRESHOLD_DEFAULT = 0.5;

const isAnchored = (s: ClusterStrategy): boolean => ANCHORED_STRATEGIES.has(s);

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

  const sorted = [...clusters].sort((a, b) => {
    const aAnchored = isAnchored(a.strategy);
    const bAnchored = isAnchored(b.strategy);
    if (aAnchored !== bAnchored) return aAnchored ? -1 : 1;
    return (
      b.testCount - a.testCount || STRATEGY_PRECEDENCE[b.strategy] - STRATEGY_PRECEDENCE[a.strategy]
    );
  });

  const winners: FailureCluster[] = [];
  const winnerTestSets: Array<Set<string>> = [];

  for (const candidate of sorted) {
    const candidateKeys = new Set(candidate.tests.map(testKeyOf));

    const overlapIndex = winnerTestSets.findIndex((winnerSet, idx) => {
      const smaller = Math.min(winnerSet.size, candidateKeys.size);
      if (smaller === 0) return false;
      let shared = 0;
      for (const k of candidateKeys) {
        if (winnerSet.has(k)) shared++;
      }
      const winnerAnchored = isAnchored(winners[idx].strategy);
      const candidateAnchored = isAnchored(candidate.strategy);
      const threshold =
        winnerAnchored && !candidateAnchored
          ? OVERLAP_THRESHOLD_ANCHORED_WINS
          : OVERLAP_THRESHOLD_DEFAULT;
      return shared / smaller >= threshold;
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

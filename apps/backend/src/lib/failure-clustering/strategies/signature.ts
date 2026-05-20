import { v4 as uuid } from 'uuid';
import { parseFailureDetails } from '../extractors/failure-details.js';
import { type ClusterWithRuns, FAILED_OUTCOMES, type FailedTestRun, testKey } from '../types.js';

export interface SignatureStrategyOptions {
  minTests: number;
}

/**
 * Groups failed runs by their normalized error signature. A cluster is emitted
 * when ≥ `minTests` distinct (testId, fileId, project) tuples share a signature.
 */
export function clusterBySignature(
  runs: FailedTestRun[],
  opts: SignatureStrategyOptions
): ClusterWithRuns[] {
  const bySignature = new Map<string, FailedTestRun[]>();
  for (const run of runs) {
    if (!FAILED_OUTCOMES.has(run.outcome)) continue;
    const sig = run.errorSignatureGlobal;
    if (!sig) continue;
    const list = bySignature.get(sig) ?? [];
    list.push(run);
    bySignature.set(sig, list);
  }

  const result: ClusterWithRuns[] = [];
  for (const [signature, group] of bySignature) {
    const uniqueTests = new Set(group.map((r) => testKey(r.testId, r.fileId, r.project)));
    if (uniqueTests.size < opts.minTests) continue;

    const sampleMessage = extractSampleMessage(group);
    const categoryCounts = new Map<string, number>();
    for (const r of group) {
      if (r.failureCategory) {
        categoryCounts.set(r.failureCategory, (categoryCounts.get(r.failureCategory) ?? 0) + 1);
      }
    }
    const category = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    result.push({
      cluster: {
        id: uuid(),
        strategy: 'signature',
        name: buildName(sampleMessage),
        sampleMessage,
        category,
        testCount: uniqueTests.size,
        failureCount: group.length,
        estimatedFixes: 1,
        evidence: { signature },
        tests: [],
      },
      runs: group,
    });
  }

  return result.sort((a, b) => b.cluster.failureCount - a.cluster.failureCount);
}

function extractSampleMessage(runs: FailedTestRun[]): string {
  for (const run of runs) {
    const parsed = parseFailureDetails(run.failureDetails);
    if (parsed?.message) return parsed.message;
  }
  return '';
}

function buildName(message: string): string {
  if (!message) return 'Shared error signature';
  const firstLine = message.split('\n')[0]?.trim() ?? '';
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
}

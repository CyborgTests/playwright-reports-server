import { v4 as uuid } from 'uuid';
import { parseFailureDetails } from '../extractors/failure-details.js';
import { isGenericMessage } from '../extractors/generic-message.js';
import { extractFrameFromFailure } from '../extractors/stack-trace.js';
import { type ClusterWithRuns, FAILED_OUTCOMES, type FailedTestRun, testKey } from '../types.js';

export interface SignatureStrategyOptions {
  minTests: number;
}

/**
 * Groups failed runs by their normalized error signature. A cluster is emitted
 * when ≥ `minTests` distinct (testId, fileId, project) tuples share a signature.
 *
 * Runs whose raw message matches a generic pattern (e.g. "Test timeout of Nms
 * exceeded") are excluded from signature-based clustering — see
 * `extractors/generic-message.ts`. They remain eligible for stack-frame,
 * fixture, and temporal strategies.
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
    const parsed = parseFailureDetails(run.failureDetails);
    if (isGenericMessage(parsed?.message)) continue;
    const list = bySignature.get(sig) ?? [];
    list.push(run);
    bySignature.set(sig, list);
  }

  const result: ClusterWithRuns[] = [];
  for (const [signature, group] of bySignature) {
    const uniqueTests = new Set(group.map((r) => testKey(r.testId, r.fileId, r.project)));
    if (uniqueTests.size < opts.minTests) continue;

    // Stack-frame agreement check: if members of this signature group crash
    // at distinct app-code frames, they probably are not one root cause.
    // Split into per-frame sub-clusters; each must independently meet
    // minTests. Runs without an extractable frame collect into a residual
    // bucket and emit only if they still meet the floor.
    const byFrame = new Map<string, FailedTestRun[]>();
    const framelessRuns: FailedTestRun[] = [];
    for (const run of group) {
      const parsed = parseFailureDetails(run.failureDetails);
      const frame = parsed ? extractFrameFromFailure(parsed) : undefined;
      if (frame) {
        const list = byFrame.get(frame) ?? [];
        list.push(run);
        byFrame.set(frame, list);
      } else {
        framelessRuns.push(run);
      }
    }

    if (byFrame.size <= 1) {
      // All members share a frame (or none have one) — emit as a single
      // cluster, unchanged.
      result.push(buildSignatureCluster(signature, group, undefined));
      continue;
    }

    // Members disagree on stack frame — split. Each frame becomes its own
    // cluster; the frameless residual is only emitted if it stands on its
    // own as a real grouping.
    for (const [frame, frameRuns] of byFrame) {
      const frameUniqueTests = new Set(
        frameRuns.map((r) => testKey(r.testId, r.fileId, r.project))
      );
      if (frameUniqueTests.size < opts.minTests) continue;
      result.push(buildSignatureCluster(signature, frameRuns, frame));
    }
    if (framelessRuns.length > 0) {
      const framelessUniqueTests = new Set(
        framelessRuns.map((r) => testKey(r.testId, r.fileId, r.project))
      );
      if (framelessUniqueTests.size >= opts.minTests) {
        result.push(buildSignatureCluster(signature, framelessRuns, undefined));
      }
    }
  }

  return result.sort((a, b) => b.cluster.failureCount - a.cluster.failureCount);
}

function buildSignatureCluster(
  signature: string,
  runs: FailedTestRun[],
  stackFrame: string | undefined
): ClusterWithRuns {
  const uniqueTests = new Set(runs.map((r) => testKey(r.testId, r.fileId, r.project)));
  const sampleMessage = extractSampleMessage(runs);
  const categoryCounts = new Map<string, number>();
  for (const r of runs) {
    if (r.failureCategory) {
      categoryCounts.set(r.failureCategory, (categoryCounts.get(r.failureCategory) ?? 0) + 1);
    }
  }
  const category = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const baseName = buildName(sampleMessage);
  const name = stackFrame ? `${baseName} — at ${stackFrame}` : baseName;
  return {
    cluster: {
      id: uuid(),
      strategy: 'signature',
      name,
      sampleMessage,
      category,
      testCount: uniqueTests.size,
      failureCount: runs.length,
      evidence: stackFrame ? { signature, stackFrame } : { signature },
      tests: [],
    },
    runs,
  };
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

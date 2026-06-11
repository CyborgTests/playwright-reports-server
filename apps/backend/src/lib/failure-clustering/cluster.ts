import { createHash } from 'node:crypto';
import type {
  ClusterAnchor,
  ClusterConfidence,
  ClusterTest,
  FailureCluster,
} from '@playwright-reports/shared';
import { anchorKey, classify } from './classify.js';
import { type ParsedFailureDetails, parseFailureDetails } from './extractors/failure-details.js';
import type { FailedTestRun, TestMeta } from './types.js';
import { testKey } from './types.js';

export type ReportUrlLookup = (reportId: string) => string | undefined;

interface AnnotatedRun {
  run: FailedTestRun;
  parsed: ParsedFailureDetails;
  anchor: ClusterAnchor;
}

export function buildClusters(
  failedRuns: FailedTestRun[],
  metaByKey: Map<string, TestMeta>,
  resolveReportUrl: ReportUrlLookup
): FailureCluster[] {
  // 1. Annotate every run with its parsed failure_details and anchor.
  const annotated: AnnotatedRun[] = [];
  for (const run of failedRuns) {
    const parsed = parseFailureDetails(run.failureDetails);
    if (!parsed) continue;
    annotated.push({ run, parsed, anchor: classify(run, parsed) });
  }

  // 2. Bucket by anchor key.
  const buckets = new Map<string, AnnotatedRun[]>();
  for (const a of annotated) {
    const key = anchorKey(a.anchor);
    const list = buckets.get(key);
    if (list) list.push(a);
    else buckets.set(key, [a]);
  }

  // 3. Coalesce adjacent-line frame buckets in the same (file, verb) within
  //    a short line window. Same helper function with multiple assertions on
  //    adjacent lines otherwise produces a separate cluster per assertion line
  coalesceAdjacentFrameBuckets(buckets);

  // 4. Emit one cluster per bucket.
  const clusters: FailureCluster[] = [];
  for (const [key, members] of buckets) {
    clusters.push(buildOneCluster(members[0].anchor, key, members, metaByKey, resolveReportUrl));
  }

  // 5. Impact-sort: higher failureCount × testCount come first.
  clusters.sort((a, b) => {
    const impact = b.failureCount * b.testCount - a.failureCount * a.testCount;
    if (impact !== 0) return impact;
    if (b.failureCount !== a.failureCount) return b.failureCount - a.failureCount;
    return a.id.localeCompare(b.id);
  });

  return clusters;
}

const ADJACENT_FRAME_LINE_GAP = 10;

function coalesceAdjacentFrameBuckets(buckets: Map<string, AnnotatedRun[]>): void {
  interface Entry {
    key: string;
    file: string;
    line: number;
    verb: string;
  }
  // Group frame buckets by (file, verb).
  const groups = new Map<string, Entry[]>();
  for (const [key, members] of buckets) {
    const anchor = members[0].anchor;
    if (anchor.kind !== 'frame') continue;
    const m = /^(.*):(\d+)$/.exec(anchor.frame);
    if (!m) continue;
    const file = m[1];
    const line = Number.parseInt(m[2], 10);
    if (!Number.isFinite(line)) continue;
    const groupKey = `${file}|${anchor.verb}`;
    const entry: Entry = { key, file, line, verb: anchor.verb };
    const arr = groups.get(groupKey);
    if (arr) arr.push(entry);
    else groups.set(groupKey, [entry]);
  }

  for (const entries of groups.values()) {
    if (entries.length < 2) continue;
    entries.sort((a, b) => a.line - b.line);
    // sliding-window merge: each entry joins the previous if within
    // the line gap. Keeps the anchor on the lowest line.
    let survivor = entries[0];
    for (let i = 1; i < entries.length; i++) {
      const next = entries[i];
      if (next.line - survivor.line <= ADJACENT_FRAME_LINE_GAP) {
        // Move members of `next` into `survivor` and drop the next bucket.
        const survivorMembers = buckets.get(survivor.key);
        const nextMembers = buckets.get(next.key);
        if (survivorMembers && nextMembers) {
          // Rewrite frame anchor on incoming members so anchorKey/clusterId
          // stays consistent inside the surviving bucket.
          for (const m of nextMembers) {
            if (m.anchor.kind === 'frame') {
              m.anchor = { ...m.anchor, frame: `${survivor.file}:${survivor.line}` };
            }
            survivorMembers.push(m);
          }
          buckets.delete(next.key);
        }
        // Don't advance survivor - stay anchored on the lowest line so
        // every following member that fits the window merges in too.
      } else {
        survivor = next;
      }
    }
  }
}

function buildOneCluster(
  anchor: ClusterAnchor,
  key: string,
  members: AnnotatedRun[],
  metaByKey: Map<string, TestMeta>,
  resolveReportUrl: ReportUrlLookup
): FailureCluster {
  const id = clusterId(key);

  const byTest = new Map<
    string,
    { run: FailedTestRun; occurrences: number; lastSeen: string; lastReportId: string }
  >();
  for (const { run } of members) {
    const k = testKey(run.testId, run.fileId, run.project);
    const existing = byTest.get(k);
    if (!existing) {
      byTest.set(k, {
        run,
        occurrences: 1,
        lastSeen: run.createdAt,
        lastReportId: run.reportId,
      });
    } else {
      existing.occurrences++;
      if (run.createdAt > existing.lastSeen) {
        existing.lastSeen = run.createdAt;
        existing.lastReportId = run.reportId;
      }
    }
  }

  const tests: ClusterTest[] = [];
  for (const [k, info] of byTest) {
    const meta = metaByKey.get(k);
    tests.push({
      testId: info.run.testId,
      fileId: info.run.fileId,
      project: info.run.project,
      title: meta?.title ?? 'Unknown test',
      filePath: meta?.filePath,
      occurrences: info.occurrences,
      lastSeen: info.lastSeen,
      lastReportId: info.lastReportId,
      lastReportUrl: resolveReportUrl(info.lastReportId),
    });
  }
  tests.sort((a, b) => b.occurrences - a.occurrences);

  const sampleSource = pickRepresentativeSample(members);
  const sampleMessage = sampleSource.parsed.message;
  const sampleCodeframe = extractCodeframeLine(sampleMessage);

  // Category: most common failureCategory among member runs.
  const categoryCounts = new Map<string, number>();
  for (const { run } of members) {
    if (!run.failureCategory) continue;
    categoryCounts.set(run.failureCategory, (categoryCounts.get(run.failureCategory) ?? 0) + 1);
  }
  const category = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return {
    id,
    anchor,
    name: buildName(anchor, sampleMessage, tests),
    sampleMessage,
    sampleCodeframe,
    category,
    confidence: deriveConfidence(anchor.kind, tests.length, members.length),
    chronicFlake: isChronicFlake(tests.length, members.length),
    testCount: tests.length,
    failureCount: members.length,
    tests,
  };
}

const CHRONIC_FLAKE_MIN_FAILURES = 10;

function isChronicFlake(testCount: number, failureCount: number): boolean {
  return testCount === 1 && failureCount >= CHRONIC_FLAKE_MIN_FAILURES;
}

/** Stable ID = hex sha1 of the anchor key, truncated to 16 chars. Same anchor
 *  → same ID, across calls and across servers. */
function clusterId(key: string): string {
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}

/** Pick the most representative run in a cluster — the one whose message
 *  shape repeats most often. */
function pickRepresentativeSample(members: AnnotatedRun[]): AnnotatedRun {
  if (members.length === 1) return members[0];
  const shapeCounts = new Map<string, { count: number; member: AnnotatedRun }>();
  for (const m of members) {
    const shape = messageShape(m.parsed.message);
    const existing = shapeCounts.get(shape);
    if (existing) {
      existing.count++;
      // Prefer the most-recent member within the modal shape so the sample
      // also has a recent createdAt — keeps the cluster's lastSeen aligned.
      if (m.run.createdAt > existing.member.run.createdAt) existing.member = m;
    } else {
      shapeCounts.set(shape, { count: 1, member: m });
    }
  }
  let best: { count: number; member: AnnotatedRun } | undefined;
  for (const entry of shapeCounts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best?.member ?? members[0];
}

function messageShape(message: string): string {
  return message
    .replace(/\d+/g, 'N')
    .replace(/'[^']*'/g, "'V'")
    .replace(/"[^"]*"/g, '"V"')
    .replace(/0x[0-9a-fA-F]+/g, 'H')
    .slice(0, 240);
}

function extractCodeframeLine(message: string): string | undefined {
  for (const raw of message.split('\n')) {
    const match = /^\s*>\s*(\d+\s*\|.+)$/.exec(raw);
    if (match) return match[1].trim();
  }
  return undefined;
}

/** Human-readable cluster name shaped as a sentence */
function buildName(anchor: ClusterAnchor, sampleMessage: string, tests: ClusterTest[]): string {
  switch (anchor.kind) {
    case 'fixture':
      return `${anchor.phase} hook failure in ${anchor.filePath}`;
    case 'selector':
      return `${verbLabel(anchor.verb)} on ${truncate(anchor.selector, 80)}`;
    case 'frame':
      return `${verbLabel(anchor.verb)} at ${anchor.frame}`;
    case 'signature': {
      const symptom = firstSignificantLine(sampleMessage);
      const verb = verbLabel(anchor.verb);
      return symptom ? `${verb}: ${truncate(symptom, 70)}` : `${verb} (shared signature)`;
    }
    case 'unmatched': {
      const title = tests[0]?.title ?? 'Unknown test';
      const symptom = firstSignificantLine(sampleMessage);
      return symptom ? `Unmatched: ${title} — ${truncate(symptom, 60)}` : `Unmatched: ${title}`;
    }
  }
}

/** Friendly verb labels for the cluster name. */
function verbLabel(verb: string): string {
  if (verb === 'strictModeViolation') return 'Ambiguous selector';
  if (verb === 'testTimeout') return 'Test timeout';
  if (verb === 'unknown') return 'Failure';
  return verb;
}

function firstSignificantLine(message: string): string {
  return (
    message
      .split('\n')
      .find((l) => l.trim().length > 0)
      ?.trim() ?? ''
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Confidence reflects how reliably "one fix resolves all" holds for a
 *  cluster. Used by the UI to visually tier cards and by the LLM to weight
 *  whether to investigate the cluster as a single root cause vs. as a
 *  collection of similar-looking failures. */
function deriveConfidence(
  kind: ClusterAnchor['kind'],
  testCount: number,
  failureCount: number
): ClusterConfidence {
  if (kind === 'fixture') return 'high';
  if (kind === 'unmatched') return 'low';
  if (testCount >= 3) return 'high';
  if (testCount === 2) return 'medium';
  // testCount === 1
  return failureCount >= 3 ? 'medium' : 'low';
}

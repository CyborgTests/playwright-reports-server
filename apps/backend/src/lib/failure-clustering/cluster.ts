import { createHash } from 'node:crypto';
import type {
  ClusterAnchor,
  ClusterConfidence,
  ClusterTest,
  FailureCluster,
  FixturePhase,
  PlaywrightVerb,
} from '@playwright-reports/shared';
import { type ParsedFailureDetails, parseFailureDetails } from './extractors/failure-details.js';
import { extractVerb } from './extractors/verb.js';
import {
  canonicalKey,
  FIXTURE_PREFIX,
  FRAME_PREFIX,
  GLOBAL_PREFIX,
  keysFor,
  LOCATOR_PREFIX,
  MESSAGE_PREFIX,
  messageSignature,
} from './keys.js';
import { type RouteScope, route } from './route.js';
import type { FailedTestRun, TestMeta } from './types.js';
import { testKey } from './types.js';
import { UnionFind } from './union-find.js';

export type ReportUrlLookup = (reportId: string) => string | undefined;

interface AnnotatedRun {
  run: FailedTestRun;
  parsed: ParsedFailureDetails;
  keys: string[];
}

const ADJACENT_FRAME_LINE_GAP = 10;

export function buildClusters(
  failedRuns: FailedTestRun[],
  metaByKey: Map<string, TestMeta>,
  resolveReportUrl: ReportUrlLookup
): FailureCluster[] {
  // Annotate every run with parsed details and its clustering keys; feed
  //    keys into a union-find, linking all keys of a single run.
  const annotated: AnnotatedRun[] = [];
  const uf = new UnionFind();
  for (const run of failedRuns) {
    const parsed = parseFailureDetails(run.failureDetails);
    if (!parsed) continue;
    const keys = keysFor(parsed, route(parsed.message));
    for (const key of keys) uf.add(key);
    for (let i = 1; i < keys.length; i++) uf.union(keys[0], keys[i]);
    annotated.push({ run, parsed, keys });
  }

  // Adjacency: union frame keys in the same file within a short line gap, so
  //    multiple assertions on adjacent lines form one cluster (verb-agnostic).
  unionAdjacentFrames(uf);

  // Group runs by their component, collecting the component's full key set.
  interface Component {
    members: AnnotatedRun[];
    keys: Set<string>;
  }
  const components = new Map<string, Component>();
  for (const a of annotated) {
    const root = uf.find(a.keys[0]);
    let comp = components.get(root);
    if (!comp) {
      comp = { members: [], keys: new Set() };
      components.set(root, comp);
    }
    comp.members.push(a);
    for (const key of a.keys) comp.keys.add(key);
  }

  // Emit one cluster per component.
  const clusters: FailureCluster[] = [];
  for (const comp of components.values()) {
    const canonical = canonicalKey([...comp.keys]);
    clusters.push(buildOneCluster(canonical, comp.members, metaByKey, resolveReportUrl));
  }

  // Impact-sort: higher failureCount x testCount come first.
  clusters.sort((a, b) => {
    const impact = b.failureCount * b.testCount - a.failureCount * a.testCount;
    if (impact !== 0) return impact;
    if (b.failureCount !== a.failureCount) return b.failureCount - a.failureCount;
    return a.id.localeCompare(b.id);
  });

  return clusters;
}

function unionAdjacentFrames(uf: UnionFind): void {
  interface FrameNode {
    key: string;
    file: string;
    line: number;
  }
  const byFile = new Map<string, FrameNode[]>();
  for (const node of uf.nodes()) {
    if (!node.startsWith(FRAME_PREFIX)) continue;
    const body = node.slice(FRAME_PREFIX.length);
    const m = /^(.*):(\d+)$/.exec(body);
    if (!m) continue;
    const line = Number.parseInt(m[2], 10);
    if (!Number.isFinite(line)) continue;
    const file = m[1];
    const arr = byFile.get(file);
    if (arr) arr.push({ key: node, file, line });
    else byFile.set(file, [{ key: node, file, line }]);
  }
  for (const list of byFile.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.line - b.line);
    let anchor = list[0];
    for (let i = 1; i < list.length; i++) {
      if (list[i].line - anchor.line <= ADJACENT_FRAME_LINE_GAP) {
        uf.union(anchor.key, list[i].key);
      } else {
        anchor = list[i];
      }
    }
  }
}

function buildOneCluster(
  canonical: string,
  members: AnnotatedRun[],
  metaByKey: Map<string, TestMeta>,
  resolveReportUrl: ReportUrlLookup
): FailureCluster {
  const id = clusterId(canonical);
  const scope: RouteScope = canonical.startsWith(GLOBAL_PREFIX) ? 'global' : 'local';
  const sampleSource = pickRepresentativeSample(members);
  const sampleMessage = sampleSource.parsed.message;
  const sampleCodeframe = extractCodeframeLine(sampleMessage);
  const verb = extractVerb(sampleMessage);
  const anchor = deriveAnchor(canonical, verb);

  const byTest = new Map<
    string,
    { run: FailedTestRun; occurrences: number; lastSeen: string; lastReportId: string }
  >();
  for (const { run } of members) {
    const k = testKey(run.testId, run.fileId, run.project);
    const existing = byTest.get(k);
    if (!existing) {
      byTest.set(k, { run, occurrences: 1, lastSeen: run.createdAt, lastReportId: run.reportId });
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
    scope,
    name: buildName(anchor, scope, category, sampleMessage, members),
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

// get the display anchor from the component's canonical key.
function deriveAnchor(canonical: string, verb: PlaywrightVerb): ClusterAnchor {
  if (canonical.startsWith(FIXTURE_PREFIX)) {
    const body = canonical.slice(FIXTURE_PREFIX.length);
    const sep = body.indexOf(':');
    const phase = (sep === -1 ? body : body.slice(0, sep)) as FixturePhase;
    const filePath = sep === -1 ? '' : body.slice(sep + 1);
    return { kind: 'fixture', verb, phase, filePath };
  }
  if (canonical.startsWith(LOCATOR_PREFIX)) {
    return { kind: 'selector', verb, selector: canonical.slice(LOCATOR_PREFIX.length) };
  }
  if (canonical.startsWith(FRAME_PREFIX)) {
    return { kind: 'frame', verb, frame: canonical.slice(FRAME_PREFIX.length) };
  }
  const signature = canonical.startsWith(GLOBAL_PREFIX)
    ? canonical.slice(GLOBAL_PREFIX.length)
    : canonical.slice(MESSAGE_PREFIX.length);
  return { kind: 'signature', verb, signature };
}

const CHRONIC_FLAKE_MIN_FAILURES = 10;

function isChronicFlake(testCount: number, failureCount: number): boolean {
  return testCount === 1 && failureCount >= CHRONIC_FLAKE_MIN_FAILURES;
}

/** stable ID = hex sha1 of the canonical key, truncated to 16 chars. */
function clusterId(key: string): string {
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}

function pickRepresentativeSample(members: AnnotatedRun[]): AnnotatedRun {
  if (members.length === 1) return members[0];
  const shapeCounts = new Map<string, { count: number; member: AnnotatedRun }>();
  for (const m of members) {
    const shape = messageSignature(m.parsed.message);
    const existing = shapeCounts.get(shape);
    if (existing) {
      existing.count++;
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

function extractCodeframeLine(message: string): string | undefined {
  for (const raw of message.split('\n')) {
    const match = /^\s*>\s*(\d+\s*\|.+)$/.exec(raw);
    if (match) return match[1].trim();
  }
  return undefined;
}

// readable labels for the heuristic failure categories.
const CATEGORY_LABELS: Record<string, string> = {
  element_not_visible: 'Element not visible',
  element_not_found: 'Element not found',
  assertion_error: 'Assertion failed',
  timeout: 'Timeout',
  network_error: 'Network error',
  api_error: 'API error',
  authentication_error: 'Auth error',
  navigation_error: 'Navigation error',
  browser_crash: 'Browser crash',
  snapshot_mismatch: 'Snapshot mismatch',
  setup_teardown: 'Setup/teardown failure',
  javascript_error: 'JS error',
};

/**
 * readable cluster name:
 *   `[Local|Global] <what> [on <target>] [in <file:line> | across N files]`
 * location is included only when the cluster's failures share one file
 * when it spans several use "across N files" instead.
 */
function buildName(
  anchor: ClusterAnchor,
  scope: RouteScope,
  category: string | undefined,
  sampleMessage: string,
  members: AnnotatedRun[]
): string {
  const scopeLabel = scope === 'global' ? 'Global' : 'Local';
  const categoryLabel = category ? CATEGORY_LABELS[category] : undefined;

  let what = 'Failure';
  let target: string | undefined;
  let location: string | undefined;

  switch (anchor.kind) {
    case 'fixture':
      what = `${anchor.phase} hook failure`;
      location = anchor.filePath || undefined;
      break;
    case 'selector':
      what = categoryLabel ?? verbLabel(anchor.verb);
      target = truncate(anchor.selector, 60);
      location = sharedLocation(members);
      break;
    case 'frame':
      what = categoryLabel ?? verbLabel(anchor.verb);
      location = anchor.frame; // single by construction
      break;
    case 'signature': {
      what = categoryLabel ?? firstSignificantLine(sampleMessage) ?? verbLabel(anchor.verb);
      what = truncate(what, 70);
      // global signatures intentionally span files - no single location.
      location = scope === 'global' ? undefined : sharedLocation(members);
      break;
    }
  }

  let name = `${scopeLabel} · ${what}`;
  if (target) name += ` on ${target}`;
  if (location) name += ` in ${location}`;
  return name;
}

/**
 * The shared file:line across members, for the name's "in …" suffix:
 *   - one distinct frame -> that frame (file:line)
 *   - one distinct file (varying lines) -> just the file
 *   - several files -> undefined (caller renders "across N files" / nothing)
 */
function sharedLocation(members: AnnotatedRun[]): string | undefined {
  const frames = new Set<string>();
  for (const m of members) {
    for (const key of m.keys) {
      if (key.startsWith(FRAME_PREFIX)) frames.add(key.slice(FRAME_PREFIX.length));
    }
  }
  if (frames.size === 0) return undefined;
  if (frames.size === 1) return [...frames][0];
  const files = new Set([...frames].map((f) => f.replace(/:\d+$/, '')));
  if (files.size === 1) return [...files][0];
  return `${files.size} files`;
}

function verbLabel(verb: string): string {
  if (verb === 'strictModeViolation') return 'Ambiguous selector';
  if (verb === 'testTimeout') return 'Test timeout';
  if (verb === 'unknown') return 'Failure';
  return verb;
}

function firstSignificantLine(message: string): string | undefined {
  return (
    message
      .split('\n')
      .find((l) => l.trim().length > 0)
      ?.trim() ?? undefined
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function deriveConfidence(
  kind: ClusterAnchor['kind'],
  testCount: number,
  failureCount: number
): ClusterConfidence {
  if (kind === 'fixture') return 'high';
  if (kind === 'unmatched') return 'low';
  if (testCount >= 3) return 'high';
  if (testCount === 2) return 'medium';
  return failureCount >= 3 ? 'medium' : 'low';
}

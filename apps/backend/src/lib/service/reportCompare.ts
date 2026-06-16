import type { ReportStats } from '@playwright-reports/shared';
import type { ReportHistory } from '../storage/types.js';
import { regressionsDb, reportDb, type Test, type TestRunRow, testDb } from './db/index.js';

const FAILURE_OUTCOMES = new Set(['failed', 'unexpected', 'timedOut']);
const PASS_OUTCOMES = new Set(['passed', 'expected']);

// Duration deltas smaller than these thresholds are noise and get dropped.
const MIN_DURATION_DELTA_MS = 250;
const MIN_DURATION_DELTA_PCT = 0.2;
const MAX_DURATION_DELTAS_RETURNED = 50;

export type DiffOutcome = 'pass' | 'fail' | 'flaky' | 'skipped' | 'unknown';

const classifyOutcome = (outcome: string): DiffOutcome => {
  if (FAILURE_OUTCOMES.has(outcome)) return 'fail';
  if (PASS_OUTCOMES.has(outcome)) return 'pass';
  if (outcome === 'flaky') return 'flaky';
  if (outcome === 'skipped') return 'skipped';
  return 'unknown';
};

export interface ReportRef {
  reportID: string;
  title?: string;
  displayNumber?: number;
  project: string;
  createdAt: string;
  reportUrl: string;
  stats?: ReportStats;
}

export interface DiffTestEntry {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath: string;
  outcomeA?: DiffOutcome;
  outcomeB?: DiffOutcome;
  rawOutcomeA?: string;
  rawOutcomeB?: string;
  durationA?: number;
  durationB?: number;
}

export interface DurationDeltaEntry extends DiffTestEntry {
  durationA: number;
  durationB: number;
  deltaMs: number;
  deltaPct: number;
}

export interface ReportDiffSummary {
  totalA: number;
  totalB: number;
  newlyFailedCount: number;
  fixedCount: number;
  stillFailingCount: number;
  flakyToPassCount: number;
  passToFlakyCount: number;
  newTestsCount: number;
  removedTestsCount: number;
  durationRegressionsCount: number;
  durationImprovementsCount: number;
  regressionsOpenedBetween: number;
  regressionsResolvedBetween: number;
}

export interface ReportDiffResult {
  reportA: ReportRef;
  reportB: ReportRef;
  summary: ReportDiffSummary;
  newlyFailed: DiffTestEntry[];
  fixed: DiffTestEntry[];
  stillFailing: DiffTestEntry[];
  flakyToPass: DiffTestEntry[];
  passToFlaky: DiffTestEntry[];
  newTests: DiffTestEntry[];
  removedTests: DiffTestEntry[];
  durationDeltas: DurationDeltaEntry[];
}

const toReportRef = (report: ReportHistory): ReportRef => ({
  reportID: report.reportID,
  title: report.title,
  displayNumber: report.displayNumber,
  project: report.project,
  createdAt: report.createdAt,
  reportUrl: report.reportUrl,
  stats: report.stats,
});

const matchKeyOf = (
  run: Pick<TestRunRow, 'testId' | 'fileId' | 'project'>,
  matchByTestIdOnly: boolean
) => (matchByTestIdOnly ? run.testId : `${run.testId}::${run.fileId}::${run.project}`);

const metaKeyOf = (run: Pick<TestRunRow, 'testId' | 'fileId' | 'project'>) =>
  `${run.testId}::${run.fileId}::${run.project}`;

// One report can contain multiple runs for the same test (retries written as
// separate rows historically, or future per-attempt logging). Pick the run
// whose outcome best represents the final state: prefer non-skipped, then the
// latest by createdAt.
const pickRunForTest = (runs: TestRunRow[]): TestRunRow => {
  const nonSkipped = runs.filter((r) => r.outcome !== 'skipped');
  const pool = nonSkipped.length > 0 ? nonSkipped : runs;
  return pool.reduce((latest, r) =>
    Date.parse(r.createdAt) > Date.parse(latest.createdAt) ? r : latest
  );
};

const groupRunsByKey = (
  runs: TestRunRow[],
  matchByTestIdOnly: boolean
): Map<string, TestRunRow> => {
  const byKey = new Map<string, TestRunRow[]>();
  for (const run of runs) {
    const k = matchKeyOf(run, matchByTestIdOnly);
    const existing = byKey.get(k);
    if (existing) existing.push(run);
    else byKey.set(k, [run]);
  }
  const result = new Map<string, TestRunRow>();
  for (const [k, group] of byKey) {
    result.set(k, pickRunForTest(group));
  }
  return result;
};

const buildEntry = (
  run: TestRunRow | undefined,
  partner: TestRunRow | undefined,
  meta: Test | undefined
): DiffTestEntry => {
  const source = run ?? partner;
  if (!source) {
    throw new Error('buildEntry called with no runs');
  }
  return {
    testId: source.testId,
    fileId: source.fileId,
    project: source.project,
    title: meta?.title ?? 'Unknown test',
    filePath: meta?.filePath ?? 'unknown',
    outcomeA: run ? classifyOutcome(run.outcome) : undefined,
    outcomeB: partner ? classifyOutcome(partner.outcome) : undefined,
    rawOutcomeA: run?.outcome,
    rawOutcomeB: partner?.outcome,
    durationA: run?.duration,
    durationB: partner?.duration,
  };
};

export const compareReports = (
  reportAId: string,
  reportBId: string
): { result?: ReportDiffResult; error?: string } => {
  if (reportAId === reportBId) {
    return { error: 'Cannot compare a report to itself' };
  }

  const reportA = reportDb.getByID(reportAId);
  const reportB = reportDb.getByID(reportBId);
  if (!reportA) return { error: `Report ${reportAId} not found` };
  if (!reportB) return { error: `Report ${reportBId} not found` };

  const matchByTestIdOnly = reportA.project !== reportB.project;
  const runsA = groupRunsByKey(testDb.getTestRunsByReport(reportAId), matchByTestIdOnly);
  const runsB = groupRunsByKey(testDb.getTestRunsByReport(reportBId), matchByTestIdOnly);

  const metaCache = new Map<string, Test | undefined>();
  const getMeta = (run: TestRunRow): Test | undefined => {
    const k = metaKeyOf(run);
    if (metaCache.has(k)) return metaCache.get(k);
    const meta = testDb.getTest(run.testId, run.fileId, run.project);
    metaCache.set(k, meta);
    return meta;
  };

  const newlyFailed: DiffTestEntry[] = [];
  const fixed: DiffTestEntry[] = [];
  const stillFailing: DiffTestEntry[] = [];
  const flakyToPass: DiffTestEntry[] = [];
  const passToFlaky: DiffTestEntry[] = [];
  const newTests: DiffTestEntry[] = [];
  const removedTests: DiffTestEntry[] = [];
  const durationDeltas: DurationDeltaEntry[] = [];

  const allKeys = new Set<string>([...runsA.keys(), ...runsB.keys()]);

  for (const key of allKeys) {
    const a = runsA.get(key);
    const b = runsB.get(key);
    const meta = getMeta((a ?? b) as TestRunRow);
    const entry = buildEntry(a, b, meta);

    if (a && !b) {
      removedTests.push(entry);
      continue;
    }
    if (!a && b) {
      newTests.push(entry);
      // A newly added test that fails on first run is also "newly failing"
      // — surface it under both buckets so triagers don't miss it.
      if (entry.outcomeB === 'fail') {
        newlyFailed.push(entry);
      }
      continue;
    }
    if (!a || !b) continue;

    const oa = entry.outcomeA;
    const ob = entry.outcomeB;

    if (ob === 'fail' && (oa === 'pass' || oa === 'flaky' || oa === 'skipped')) {
      newlyFailed.push(entry);
    } else if (oa === 'fail' && (ob === 'pass' || ob === 'flaky' || ob === 'skipped')) {
      fixed.push(entry);
    } else if (oa === 'fail' && ob === 'fail') {
      stillFailing.push(entry);
    } else if (oa === 'flaky' && ob === 'pass') {
      flakyToPass.push(entry);
    } else if (oa === 'pass' && ob === 'flaky') {
      passToFlaky.push(entry);
    }

    if (a.duration !== undefined && b.duration !== undefined) {
      const deltaMs = b.duration - a.duration;
      const displayPct = deltaMs / Math.max(a.duration, 1);
      const symmetricPct = deltaMs / Math.max(Math.min(a.duration, b.duration), 1);
      const significant =
        Math.abs(deltaMs) >= MIN_DURATION_DELTA_MS &&
        Math.abs(symmetricPct) >= MIN_DURATION_DELTA_PCT;
      if (significant) {
        durationDeltas.push({
          ...entry,
          durationA: a.duration,
          durationB: b.duration,
          deltaMs,
          deltaPct: displayPct,
        });
      }
    }
  }

  durationDeltas.sort((x, y) => Math.abs(y.deltaMs) - Math.abs(x.deltaMs));
  const trimmedDeltas = durationDeltas.slice(0, MAX_DURATION_DELTAS_RETURNED);

  const reportARef = toReportRef(reportA);
  const reportBRef = toReportRef(reportB);
  const [winSince, winUntil] =
    reportARef.createdAt <= reportBRef.createdAt
      ? [reportARef.createdAt, reportBRef.createdAt]
      : [reportBRef.createdAt, reportARef.createdAt];
  const regressionWindow = regressionsDb.countsBetween({
    project: matchByTestIdOnly ? undefined : reportA.project,
    since: winSince,
    until: winUntil,
  });

  const summary: ReportDiffSummary = {
    totalA: runsA.size,
    totalB: runsB.size,
    newlyFailedCount: newlyFailed.length,
    fixedCount: fixed.length,
    stillFailingCount: stillFailing.length,
    flakyToPassCount: flakyToPass.length,
    passToFlakyCount: passToFlaky.length,
    newTestsCount: newTests.length,
    removedTestsCount: removedTests.length,
    durationRegressionsCount: trimmedDeltas.filter((d) => d.deltaMs > 0).length,
    durationImprovementsCount: trimmedDeltas.filter((d) => d.deltaMs < 0).length,
    regressionsOpenedBetween: regressionWindow.opened,
    regressionsResolvedBetween: regressionWindow.resolved,
  };

  return {
    result: {
      reportA: reportARef,
      reportB: reportBRef,
      summary,
      newlyFailed,
      fixed,
      stillFailing,
      flakyToPass,
      passToFlaky,
      newTests,
      removedTests,
      durationDeltas: trimmedDeltas,
    },
  };
};

// Find the most recent report in the same project that precedes the given one.
// Used by the LLM report summary to inject trend context.
export const findPreviousReportInProject = (
  project: string,
  createdAtISO: string,
  excludeReportId: string
): { reportID: string } | null => {
  return reportDb.findPreviousInProject(project, excludeReportId, createdAtISO);
};

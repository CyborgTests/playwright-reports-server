import type { ClusterAnchor, ClusterRegressionContext } from '@playwright-reports/shared';
import { defaultConfig } from '../config.js';
import { parseFailureDetails } from '../failure-clustering/extractors/failure-details.js';
import { extractFrameFromFailure } from '../failure-clustering/extractors/stack-trace.js';
import { getFailureClusters } from '../failure-clustering/index.js';
import { FAILED_OUTCOMES } from '../failure-clustering/types.js';
import {
  analysisFeedbackDb,
  failureSummaryDb,
  projectSummaryDb,
  regressionsDb,
  reportDb,
  testAnalysisDb,
  testDb,
} from './db/index.js';
import { service } from './index.js';
import { testManagementService } from './test-management/index.js';

export const FAILED_TESTS_PER_REPORT_MAX = 50;

export const DEFAULT_HISTORY_LIMIT = 20;
export const MAX_HISTORY_LIMIT = 50;

const CLUSTER_OTHER_TESTS_MAX = 5;
const SAMPLE_FAILED_TESTS_PER_CLUSTER = 3;
const SAMPLE_UNCLUSTERED_FAILURES = 5;
const ERROR_FIRST_LINE_MAX_CHARS = 240;

interface FailureLocation {
  file: string;
  line: number;
  column?: number;
}

type NormalizedOutcome = 'passed' | 'failed' | 'flaky' | 'skipped';

function normalizeOutcome(raw: string): NormalizedOutcome {
  if (raw === 'expected' || raw === 'passed') return 'passed';
  if (raw === 'unexpected' || raw === 'failed') return 'failed';
  if (raw === 'flaky') return 'flaky';
  return 'skipped';
}

type FlakyTier = 'stable' | 'flaky' | 'critical';

export interface TestBrief {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath: string;
  signals: {
    quarantined: boolean;
    flakinessScore: number;
    flakyTier: FlakyTier;
    signatureOccurrenceCount: number;
    signatureFirstSeen?: string;
  };
  latestFailure: {
    error: string;
    category?: string;
    signature?: string;
    location?: FailureLocation;
    appFrame?: string;
    reportId: string;
    reportUrl?: string;
    createdAt: string;
    attachments?: {
      screenshotUrl?: string;
      errorContextUrl?: string;
    };
  } | null;
  llmAnalysis: {
    rootCause: string;
    fix: string;
    model?: string;
  } | null;
  feedback: {
    comment: string;
    updatedAt: string;
  } | null;
  cluster: {
    id: string;
    kind: ClusterAnchor['kind'];
    name: string;
    sampleError: string;
    otherTests: Array<{ testId: string; fileId: string; project: string; title: string }>;
    otherTestsTotal: number;
    otherTestsTruncated: boolean;
  } | null;
  regression: {
    id: string;
    regressedAtReportId: string;
    regressedAtDisplayNumber: number | null;
    regressedAtCreatedAt: string;
    regressedAtCommit: string | null;
    regressedAtCategory: string | null;
    lastGreenReportId: string | null;
    lastGreenDisplayNumber: number | null;
    lastGreenCreatedAt: string | null;
    lastGreenCommit: string | null;
    daysOpen: number;
    failureCount: number;
    flakyCount: number;
  } | null;
}

interface ReportBriefSummaryEntry {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath: string;
  category?: string;
  errorFirstLine?: string;
}

interface ReportBriefCluster {
  id: string;
  kind: ClusterAnchor['kind'];
  name: string;
  sampleError: string;
  testCount: number;
  testIds: string[];
  sampleFailedTests: ReportBriefSummaryEntry[];
}

interface ReportBriefBase {
  reportId: string;
  displayNumber?: number;
  title?: string;
  project: string;
  createdAt: string;
  reportUrl: string;
  stats: { total: number; passed: number; failed: number; flaky: number; skipped: number };
  clusterSummary: ReportBriefCluster[];
  unclusteredFailures: number;
  failedTestsTruncated: boolean;
  regressions: { newHere: number; resolvedHere: number } | null;
  runContext?: {
    gitCommit?: {
      hash?: string;
      shortHash?: string;
      branch?: string;
      subject?: string;
    };
    ciBuild?: {
      buildHref?: string;
      commitHref?: string;
      commitHash?: string;
    };
    appCommit?: string;
    appVersion?: string;
    releaseVersion?: string;
    deployedSha?: string;
  };
}

export type ReportBrief =
  | (ReportBriefBase & {
      mode: 'summary';
      sampleUnclusteredFailures: ReportBriefSummaryEntry[];
    })
  | (ReportBriefBase & {
      mode: 'full';
      failedTests: TestBrief[];
    });

interface TestHistoryRun {
  reportId: string;
  reportDisplayNumber?: number;
  reportTitle?: string;
  outcome: NormalizedOutcome;
  durationMs?: number;
  errorSignature?: string;
  category?: string;
  createdAt: string;
}

export interface TestHistory {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath: string;
  totalReturned: number;
  appliedLimit: number;
  limitClamped: boolean;
  hasMore: boolean;
  stats: {
    runs: number;
    passed: number;
    failed: number;
    flaky: number;
    skipped: number;
  };
  signatureGroups: Array<{
    signature: string;
    category?: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
  }>;
  runs: TestHistoryRun[];
}

export interface ClusterBrief {
  cluster: {
    id: string;
    kind: ClusterAnchor['kind'];
    name: string;
    sampleError: string;
    category?: string;
    confidence: 'high' | 'medium' | 'low';
    testCount: number;
    failureCount: number;
    anchor: ClusterAnchor;
  };
  members: TestBrief[];
  membersTruncated: boolean;
  regressionContext: ClusterRegressionContext | null;
}

export function resolveTestIdentity(
  testId: string,
  project: string | undefined
): { testId: string; fileId: string; project: string } | null {
  const row = testDb.findRunLane(testId, project);
  if (!row) return null;
  return { testId, fileId: row.fileId, project: row.project };
}

export function resolveTestRun(
  testId: string,
  reportId: string
): { fileId: string; project: string } | null {
  const runs = testDb.getTestRunsByReport(reportId);
  const run = runs.find((r) => r.testId === testId);
  if (!run) return null;
  return { fileId: run.fileId, project: run.project };
}

async function getFlakinessThresholds(): Promise<{ warning: number; quarantine: number }> {
  const config = await service.getConfig();
  const tm = config?.testManagement ?? {};
  return {
    warning:
      tm.warningThresholdPercentage ??
      defaultConfig.testManagement?.warningThresholdPercentage ??
      2,
    quarantine:
      tm.quarantineThresholdPercentage ??
      defaultConfig.testManagement?.quarantineThresholdPercentage ??
      5,
  };
}

function classifyFlakyTier(
  score: number,
  thresholds: { warning: number; quarantine: number }
): FlakyTier {
  if (score >= thresholds.quarantine) return 'critical';
  if (score >= thresholds.warning) return 'flaky';
  return 'stable';
}

export interface PreFetchedTestData {
  analysisByKey: ReturnType<typeof testAnalysisDb.getByTests>;
  feedbackByKey: ReturnType<typeof analysisFeedbackDb.getByTests>;
  regressionByKey: ReturnType<typeof regressionsDb.getOpenForTests>;
}

export async function buildTestBrief(
  testId: string,
  fileId: string,
  project: string,
  preFetchedClusters?: Awaited<ReturnType<typeof getFailureClusters>>,
  preFetchedThresholds?: { warning: number; quarantine: number },
  preFetched?: PreFetchedTestData
): Promise<TestBrief | null> {
  const detail = await testManagementService.getTestDetail(testId, fileId, project);
  if (!detail) return null;

  const key = `${testId}::${fileId}::${project}`;
  const latestFailedRun = detail.runs.find((r) => FAILED_OUTCOMES.has(r.outcome));
  const parsed = latestFailedRun ? parseFailureDetails(latestFailedRun.failureDetails) : undefined;

  const history =
    latestFailedRun?.errorSignature && latestFailedRun.errorSignature.length > 0
      ? testDb.getFailureHistory(
          testId,
          fileId,
          latestFailedRun.errorSignature,
          latestFailedRun.reportId
        )
      : { priorOccurrenceCount: 0, firstOccurrence: null };

  const analysisRow = preFetched
    ? (preFetched.analysisByKey.get(key) ?? null)
    : testAnalysisDb.getByTest(testId, fileId, project);
  const feedbackRow = preFetched
    ? (preFetched.feedbackByKey.get(key) ?? null)
    : analysisFeedbackDb.getByTest(testId, fileId, project);

  const thresholds = preFetchedThresholds ?? (await getFlakinessThresholds());
  const roundedScore = Math.round((detail.flakinessScore ?? 0) * 10) / 10;

  const clusterReport = preFetchedClusters ?? (await getFailureClusters({ project }));
  const containing = clusterReport.clusters.find((c) =>
    c.tests.some((t) => t.testId === testId && t.fileId === fileId && t.project === project)
  );

  return {
    testId: detail.testId,
    fileId: detail.fileId,
    project: detail.project,
    title: detail.title,
    filePath: detail.filePath,
    signals: {
      quarantined: detail.isQuarantined,
      flakinessScore: roundedScore,
      flakyTier: classifyFlakyTier(roundedScore, thresholds),
      signatureOccurrenceCount: history.priorOccurrenceCount,
      signatureFirstSeen: history.firstOccurrence?.createdAt,
    },
    latestFailure: latestFailedRun
      ? (() => {
          const reportRow = reportDb.getByID(latestFailedRun.reportId);
          return {
            error: parsed?.message ?? '',
            category: latestFailedRun.failureCategory ?? undefined,
            signature: latestFailedRun.errorSignature ?? undefined,
            location: parsed?.location
              ? {
                  file: parsed.location.file,
                  line: parsed.location.line,
                  column: parsed.location.column,
                }
              : undefined,
            appFrame: parsed ? extractFrameFromFailure(parsed) : undefined,
            reportId: latestFailedRun.reportId,
            reportUrl: reportRow?.reportUrl,
            createdAt: latestFailedRun.createdAt,
            attachments: buildAttachmentUrls(reportRow?.reportUrl, parsed?.attachments),
          };
        })()
      : null,
    llmAnalysis: analysisRow?.analysis
      ? {
          rootCause: extractSection(analysisRow.analysis, /root cause/i) ?? analysisRow.analysis,
          fix:
            extractSection(analysisRow.analysis, /recommendation|fix|best practice|solution/i) ??
            '',
          model: analysisRow.model ?? undefined,
        }
      : null,
    feedback: feedbackRow
      ? { comment: feedbackRow.comment, updatedAt: feedbackRow.updatedAt }
      : null,
    cluster: containing
      ? (() => {
          const others = containing.tests.filter((t) => t.testId !== testId || t.fileId !== fileId);
          return {
            id: containing.id,
            kind: containing.anchor.kind,
            name: containing.name,
            sampleError: containing.sampleMessage,
            otherTests: others.slice(0, CLUSTER_OTHER_TESTS_MAX).map((t) => ({
              testId: t.testId,
              fileId: t.fileId,
              project: t.project,
              title: t.title,
            })),
            otherTestsTotal: others.length,
            otherTestsTruncated: others.length > CLUSTER_OTHER_TESTS_MAX,
          };
        })()
      : null,
    regression: (() => {
      const reg = preFetched
        ? (preFetched.regressionByKey.get(key) ?? null)
        : regressionsDb.getOpenForTest(testId, fileId, project);
      if (!reg) return null;
      return {
        id: reg.id,
        regressedAtReportId: reg.regressedAtReportId,
        regressedAtDisplayNumber: reg.regressedAtDisplayNumber,
        regressedAtCreatedAt: reg.regressedAtCreatedAt,
        regressedAtCommit: reg.regressedAtCommit,
        regressedAtCategory: reg.regressedAtCategory,
        lastGreenReportId: reg.lastGreenReportId,
        lastGreenDisplayNumber: reg.lastGreenDisplayNumber,
        lastGreenCreatedAt: reg.lastGreenCreatedAt,
        lastGreenCommit: reg.lastGreenCommit,
        daysOpen: Math.round(reg.daysOpen * 10) / 10,
        failureCount: reg.failureCount,
        flakyCount: reg.flakyCount,
      };
    })(),
  };
}

export async function buildReportBrief(
  reportId: string,
  full: boolean
): Promise<ReportBrief | null> {
  const report = reportDb.getByID(reportId);
  if (!report) return null;

  const failedTestRefs = testDb
    .getTestRunsByReport(reportId)
    .filter((run) => FAILED_OUTCOMES.has(run.outcome))
    .map((run) => ({ testId: run.testId, fileId: run.fileId, project: run.project }));

  const truncated = failedTestRefs.length > FAILED_TESTS_PER_REPORT_MAX;
  const refsToBrief = failedTestRefs.slice(0, FAILED_TESTS_PER_REPORT_MAX);

  const clusterReport = await getFailureClusters({ project: report.project });
  const thresholds = await getFlakinessThresholds();

  const preFetched: PreFetchedTestData = {
    analysisByKey: testAnalysisDb.getByTests(refsToBrief),
    feedbackByKey: analysisFeedbackDb.getByTests(refsToBrief),
    regressionByKey: regressionsDb.getOpenForTests(refsToBrief),
  };

  const briefs: TestBrief[] = [];
  for (const ref of refsToBrief) {
    const brief = await buildTestBrief(
      ref.testId,
      ref.fileId,
      ref.project,
      clusterReport,
      thresholds,
      preFetched
    );
    if (brief) briefs.push(brief);
  }

  const clusterIdToFailedBriefs = new Map<string, TestBrief[]>();
  for (const brief of briefs) {
    if (!brief.cluster) continue;
    const list = clusterIdToFailedBriefs.get(brief.cluster.id) ?? [];
    list.push(brief);
    clusterIdToFailedBriefs.set(brief.cluster.id, list);
  }

  const clusterSummary: ReportBriefCluster[] = [...clusterIdToFailedBriefs.entries()]
    .map(([id, members]): ReportBriefCluster | null => {
      const cluster = clusterReport.clusters.find((c) => c.id === id);
      if (!cluster) return null;
      return {
        id,
        kind: cluster.anchor.kind,
        name: cluster.name,
        sampleError: cluster.sampleMessage,
        testCount: members.length,
        testIds: members.map((m) => m.testId),
        sampleFailedTests: members
          .slice(0, SAMPLE_FAILED_TESTS_PER_CLUSTER)
          .map(briefToSummaryEntry),
      };
    })
    .filter((c): c is ReportBriefCluster => c !== null)
    .sort((a, b) => b.testCount - a.testCount);

  const unclustered = briefs.filter((b) => !b.cluster);
  const unclusteredFailures = unclustered.length;

  const regressionCounts = regressionsDb.countsForReport(report.reportID);
  const base: ReportBriefBase = {
    reportId: report.reportID,
    displayNumber: report.displayNumber,
    title: report.title,
    project: report.project,
    createdAt: report.createdAt,
    reportUrl: report.reportUrl,
    stats: {
      total: report.stats?.total ?? 0,
      passed: report.stats?.expected ?? 0,
      failed: report.stats?.unexpected ?? 0,
      flaky: report.stats?.flaky ?? 0,
      skipped: report.stats?.skipped ?? 0,
    },
    clusterSummary,
    unclusteredFailures,
    failedTestsTruncated: truncated,
    regressions:
      regressionCounts.newHere === 0 && regressionCounts.resolvedHere === 0
        ? null
        : regressionCounts,
    runContext: buildReportRunContext(report),
  };

  if (full) {
    return { ...base, mode: 'full', failedTests: briefs };
  }
  return {
    ...base,
    mode: 'summary',
    sampleUnclusteredFailures: unclustered
      .slice(0, SAMPLE_UNCLUSTERED_FAILURES)
      .map(briefToSummaryEntry),
  };
}

function buildReportRunContext(report: {
  metadata?: Record<string, unknown> | null;
}): ReportBriefBase['runContext'] | undefined {
  const meta = (report.metadata ?? {}) as Record<string, unknown>;
  const out: NonNullable<ReportBriefBase['runContext']> = {};

  const gitCommit = meta.gitCommit as
    | { hash?: string; shortHash?: string; branch?: string; subject?: string }
    | undefined;
  if (gitCommit && (gitCommit.hash || gitCommit.branch || gitCommit.subject)) {
    out.gitCommit = {
      hash: gitCommit.hash,
      shortHash: gitCommit.shortHash,
      branch: gitCommit.branch,
      subject: gitCommit.subject,
    };
  }

  const ciBuild = (meta.ci ?? meta.ciBuild) as
    | { buildHref?: string; commitHref?: string; commitHash?: string }
    | undefined;
  if (ciBuild && (ciBuild.buildHref || ciBuild.commitHref || ciBuild.commitHash)) {
    out.ciBuild = {
      buildHref: ciBuild.buildHref,
      commitHref: ciBuild.commitHref,
      commitHash: ciBuild.commitHash,
    };
  }

  const pickStr = (k: string): string | undefined =>
    typeof meta[k] === 'string' && (meta[k] as string).length > 0 ? (meta[k] as string) : undefined;
  out.appCommit = pickStr('appCommit');
  out.appVersion = pickStr('appVersion');
  out.releaseVersion = pickStr('releaseVersion');
  out.deployedSha = pickStr('deployedSha');

  return Object.values(out).some((v) => v !== undefined) ? out : undefined;
}

function briefToSummaryEntry(brief: TestBrief) {
  return {
    testId: brief.testId,
    fileId: brief.fileId,
    project: brief.project,
    title: brief.title,
    filePath: brief.filePath,
    category: brief.latestFailure?.category,
    errorFirstLine: firstNonEmptyLine(brief.latestFailure?.error),
  };
}

function firstNonEmptyLine(text: string | undefined): string | undefined {
  if (!text) return undefined;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length > 0) return line.slice(0, ERROR_FIRST_LINE_MAX_CHARS);
  }
  return undefined;
}

export async function buildTestHistory(
  testId: string,
  fileId: string,
  project: string,
  limit: number,
  requestedLimit: number
): Promise<TestHistory | null> {
  const test = await testManagementService.getTest(testId, fileId, project);
  if (!test) return null;
  const runs = testDb.getTestRuns(testId, fileId, project);
  const sliced = runs.slice(0, limit);

  const stats = { runs: runs.length, passed: 0, failed: 0, flaky: 0, skipped: 0 };
  for (const r of runs) {
    if (r.outcome === 'expected' || r.outcome === 'passed') stats.passed++;
    else if (r.outcome === 'unexpected' || r.outcome === 'failed') stats.failed++;
    else if (r.outcome === 'flaky') stats.flaky++;
    else if (r.outcome === 'skipped') stats.skipped++;
  }

  const groupKey = (sig?: string) => (sig && sig.length > 0 ? sig : '__no_signature__');
  const groups = new Map<
    string,
    { signature: string; category?: string; count: number; firstSeen: string; lastSeen: string }
  >();
  for (const r of runs) {
    if (!FAILED_OUTCOMES.has(r.outcome)) continue;
    const key = groupKey(r.errorSignature);
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      if (r.createdAt < existing.firstSeen) existing.firstSeen = r.createdAt;
      if (r.createdAt > existing.lastSeen) existing.lastSeen = r.createdAt;
      if (!existing.category && r.failureCategory) existing.category = r.failureCategory;
    } else {
      groups.set(key, {
        signature: r.errorSignature ?? '',
        category: r.failureCategory,
        count: 1,
        firstSeen: r.createdAt,
        lastSeen: r.createdAt,
      });
    }
  }
  const signatureGroups = [...groups.values()].sort((a, b) => b.count - a.count);

  return {
    testId: test.testId,
    fileId: test.fileId,
    project: test.project,
    title: test.title,
    filePath: test.filePath,
    totalReturned: sliced.length,
    appliedLimit: limit,
    limitClamped: requestedLimit !== limit,
    hasMore: runs.length > sliced.length,
    stats,
    signatureGroups,
    runs: sliced.map((r) => ({
      reportId: r.reportId,
      reportDisplayNumber: r.reportDisplayNumber,
      reportTitle: r.reportTitle,
      outcome: normalizeOutcome(r.outcome),
      durationMs: r.duration,
      errorSignature: r.errorSignature,
      category: r.failureCategory,
      createdAt: r.createdAt,
    })),
  };
}

export async function buildClusterBrief(
  clusterId: string,
  project: string | undefined
): Promise<ClusterBrief | null> {
  const tryProjects: Array<string | undefined> = project ? [project, undefined] : [undefined];
  let cluster: Awaited<ReturnType<typeof getFailureClusters>>['clusters'][number] | undefined;
  let report: Awaited<ReturnType<typeof getFailureClusters>> | undefined;
  for (const p of tryProjects) {
    const candidate = await getFailureClusters({ project: p });
    const found = candidate.clusters.find((c) => c.id === clusterId);
    if (found) {
      cluster = found;
      report = candidate;
      break;
    }
  }
  if (!cluster || !report) return null;

  const refsToBrief = cluster.tests.slice(0, FAILED_TESTS_PER_REPORT_MAX);
  const truncated = cluster.tests.length > refsToBrief.length;
  const thresholds = await getFlakinessThresholds();

  const members: TestBrief[] = [];
  for (const t of refsToBrief) {
    const brief = await buildTestBrief(t.testId, t.fileId, t.project, report, thresholds);
    if (brief) members.push(brief);
  }

  return {
    cluster: {
      id: cluster.id,
      kind: cluster.anchor.kind,
      name: cluster.name,
      sampleError: cluster.sampleMessage,
      category: cluster.category,
      confidence: cluster.confidence,
      testCount: cluster.testCount,
      failureCount: cluster.failureCount,
      anchor: cluster.anchor,
    },
    members,
    membersTruncated: truncated,
    regressionContext: cluster.regressionContext ?? null,
  };
}

export async function buildReportSummary(reportId: string) {
  const report = reportDb.getByID(reportId);
  if (!report) return null;
  const summary = failureSummaryDb.getSummary(reportId);
  const runs = testDb.getTestRunsByReport(reportId);
  const hasFailures = runs.some((r) => FAILED_OUTCOMES.has(r.outcome));
  const regressions = regressionsDb.countsForReport(reportId);
  return {
    reportId,
    project: report.project,
    displayNumber: report.displayNumber,
    hasFailures,
    summary: summary ?? null,
    regressions: regressions.newHere === 0 && regressions.resolvedHere === 0 ? null : regressions,
  };
}

export async function buildProjectSummary(projectKey: string) {
  const row = projectSummaryDb.get(projectKey);
  let structured: unknown = null;
  if (row?.structured) {
    try {
      structured = JSON.parse(row.structured);
    } catch {
      // tolerate stale JSON
    }
  }
  return {
    project: projectKey,
    summary: row
      ? {
          summary: row.summary,
          structured,
          model: row.model,
          lastReportId: row.lastReportId,
          reportCount: row.reportCount,
          firstReportAt: row.firstReportAt,
          lastReportAt: row.lastReportAt,
          updatedAt: row.updatedAt,
        }
      : null,
  };
}

export async function buildTestAnalysis(testId: string, fileId: string, project: string) {
  const row = testAnalysisDb.getByTest(testId, fileId, project);
  return {
    testId,
    fileId,
    project,
    analysis: row?.analysis ?? null,
    model: row?.model ?? null,
    category: row?.category ?? null,
    createdAt: row?.createdAt ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function buildReportResolve(displayNumber: number, project?: string) {
  const rows = reportDb.findByDisplayNumber(displayNumber, project);
  return rows.map((r) => ({
    reportId: r.reportID,
    project: r.project,
    title: r.title ?? undefined,
    displayNumber: r.displayNumber ?? displayNumber,
    createdAt: r.createdAt,
    reportUrl: r.reportUrl,
  }));
}

export async function buildFailureCategories(project?: string) {
  return testDb.getFailureCategoryCounts(project);
}

export function buildAttachmentUrls(
  reportUrl: string | undefined,
  attachments: { name: string; path: string; contentType: string }[] | undefined
): { screenshotUrl?: string; errorContextUrl?: string } | undefined {
  if (!reportUrl || !attachments || attachments.length === 0) return undefined;
  const base = reportUrl.replace(/index\.html$/, '');
  let screenshotUrl: string | undefined;
  let errorContextUrl: string | undefined;
  for (const att of attachments) {
    if (!att?.path) continue;
    if (!screenshotUrl && att.name === 'screenshot' && att.contentType?.startsWith('image/')) {
      screenshotUrl = `${base}${att.path}`;
    } else if (!errorContextUrl && att.name === 'error-context') {
      errorContextUrl = `${base}${att.path}`;
    }
  }
  if (!screenshotUrl && !errorContextUrl) return undefined;
  return { screenshotUrl, errorContextUrl };
}

function extractSection(markdown: string, pattern: RegExp): string | undefined {
  const lines = markdown.split('\n');
  let capturing = false;
  const captured: string[] = [];
  for (const line of lines) {
    const isHeader = /^#{1,4}\s/.test(line);
    if (isHeader) {
      if (capturing) break;
      const headerText = line.replace(/^#+\s*/, '');
      if (pattern.test(headerText)) capturing = true;
      continue;
    }
    if (capturing) captured.push(line);
  }
  const text = captured.join('\n').trim();
  return text.length > 0 ? text : undefined;
}

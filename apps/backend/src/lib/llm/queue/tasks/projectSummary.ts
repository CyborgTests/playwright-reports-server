import { getFailureClusters } from '../../../failure-clustering/index.js';
import {
  computeProjectCoverageScope,
  failureSummaryDb,
  type LlmTaskRow,
  llmTasksDb,
  projectSummaryDb,
  regressionsDb,
  testAnalysisDb,
  testDb,
} from '../../../service/db/index.js';
import { reportDb } from '../../../service/db/reports.sqlite.js';
import { service } from '../../../service/index.js';
import { llmService } from '../../index.js';
import {
  linkifyDataBlockTags,
  parseProjectAnalysisFromText,
  pruneInvalidCodeRefs,
  renderProjectAnalysisAsMarkdown,
} from '../../projectAnalysis.js';
import type {
  ProjectCluster,
  ProjectTrendSignal,
  ProjectTrendWindow,
} from '../../prompts/index.js';
import {
  buildProjectSummarySegments,
  extractRootCauseParagraph,
  renderSegmentsForDebug,
} from '../../prompts/index.js';
import {
  fitToContextWindow,
  OUTPUT_RESERVE_TOKENS_BY_TASK,
  TASK_TEMPERATURE_DEFAULTS,
} from './promptFitting.js';
import { buildRunContextFromReport } from './reportEnrichment.js';

export const PROJECT_SUMMARY_REPORT_LIMIT = 20;
export const MANUAL_PROJECT_SUMMARY_PRIORITY = 5;

interface AggregateRun {
  reportId: string;
  createdAt: string;
  displayNumber?: number;
}

async function aggregateProjectClusters(
  reports: AggregateRun[],
  project: string,
  options: { topN: number }
): Promise<ProjectCluster[]> {
  if (reports.length === 0) return [];

  const oldest = reports[reports.length - 1];
  const latest = reports[0];
  const projectArg = project === 'all' ? undefined : project;

  const clusterReport = await getFailureClusters({
    project: projectArg,
    from: oldest.createdAt,
    to: latest.createdAt,
  });

  if (clusterReport.clusters.length === 0) return [];

  const testKeyToClusterIds = new Map<string, string[]>();
  for (const c of clusterReport.clusters) {
    for (const t of c.tests) {
      const key = `${t.testId}::${t.fileId}::${t.project}`;
      const list = testKeyToClusterIds.get(key) ?? [];
      list.push(c.id);
      testKeyToClusterIds.set(key, list);
    }
  }

  interface ClusterAgg {
    reportIndices: Set<number>;
    occurrences: number;
    flakyOccurrences: number;
    categories: Map<string, number>;
  }
  const aggByClusterId = new Map<string, ClusterAgg>();
  for (const c of clusterReport.clusters) {
    aggByClusterId.set(c.id, {
      reportIndices: new Set(),
      occurrences: 0,
      flakyOccurrences: 0,
      categories: new Map(),
    });
  }

  for (let i = 0; i < reports.length; i++) {
    const runs = testDb.getTestRunsByReport(reports[i].reportId);
    for (const run of runs) {
      if (run.outcome === 'expected' || run.outcome === 'skipped' || run.outcome === 'passed') {
        continue;
      }
      const key = `${run.testId}::${run.fileId}::${run.project}`;
      const clusterIds = testKeyToClusterIds.get(key);
      if (!clusterIds) continue;
      for (const cid of clusterIds) {
        const agg = aggByClusterId.get(cid);
        if (!agg) continue;
        agg.reportIndices.add(i);
        agg.occurrences++;
        if (run.outcome === 'flaky') agg.flakyOccurrences++;
        const cat = run.failureCategory ?? 'unknown';
        agg.categories.set(cat, (agg.categories.get(cat) ?? 0) + 1);
      }
    }
  }

  const projectClusters: ProjectCluster[] = [];
  for (const c of clusterReport.clusters) {
    const agg = aggByClusterId.get(c.id);
    if (!agg || agg.reportIndices.size === 0) continue;

    const newestIdx = Math.min(...agg.reportIndices);
    const oldestIdx = Math.max(...agg.reportIndices);
    const firstSeen = reports[oldestIdx];
    const lastSeen = reports[newestIdx];
    let consecutive = 0;
    while (agg.reportIndices.has(consecutive)) consecutive++;
    const retryRecoveryRate = agg.occurrences > 0 ? agg.flakyOccurrences / agg.occurrences : 0;

    let category = c.category ?? '';
    if (!category) {
      const sorted = [...agg.categories.entries()].sort((a, b) => b[1] - a[1]);
      category = sorted[0]?.[0] ?? 'unknown';
    }

    projectClusters.push({
      stableKey: c.id,
      kind: c.anchor.kind,
      anchor: c.anchor,
      category,
      occurrences: agg.occurrences,
      reportsAffected: agg.reportIndices.size,
      affectedTests: c.tests.map((t) => ({
        testId: t.testId,
        fileId: t.fileId,
        title: t.title,
        filePath: t.filePath ?? t.fileId,
        project: t.project,
      })),
      sampleMessage: c.sampleMessage,
      firstSeenReportId: firstSeen.reportId,
      firstSeenAt: firstSeen.createdAt,
      firstSeenDisplayNumber: firstSeen.displayNumber,
      lastSeenReportId: lastSeen.reportId,
      lastSeenAt: lastSeen.createdAt,
      lastSeenDisplayNumber: lastSeen.displayNumber,
      appearedInLatestRun: newestIdx === 0,
      consecutiveLatestRuns: consecutive,
      runsSinceLastSeen: newestIdx,
      flakyOccurrences: agg.flakyOccurrences,
      retryRecoveryRate,
    });
  }

  projectClusters.sort((a, b) => {
    if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
    if (b.reportsAffected !== a.reportsAffected) return b.reportsAffected - a.reportsAffected;
    return a.stableKey.localeCompare(b.stableKey);
  });

  const top = projectClusters.slice(0, options.topN);

  const repTestIds = top
    .map((cluster) => cluster.affectedTests[0]?.testId)
    .filter((id): id is string => !!id);
  const rootCauseByTestId = testAnalysisDb.getLatestAnalysisByTestIds(
    repTestIds,
    reports.map((r) => r.reportId)
  );
  for (const cluster of top) {
    const repTest = cluster.affectedTests[0];
    if (!repTest) continue;
    const analysis = rootCauseByTestId.get(repTest.testId);
    if (analysis) {
      cluster.latestRootCause = extractRootCauseParagraph(analysis);
    }
  }

  return top;
}

interface TrendReportLike {
  stats?: { expected?: number; unexpected?: number; flaky?: number };
  duration?: number;
  displayNumber?: number;
}

function summarizeReportsForTrend(reports: TrendReportLike[]): ProjectTrendWindow {
  let expected = 0;
  let unexpected = 0;
  let flaky = 0;
  let durationSum = 0;
  let durationDenom = 0;
  let passingRuns = 0;
  for (const r of reports) {
    const e = r.stats?.expected ?? 0;
    const u = r.stats?.unexpected ?? 0;
    const f = r.stats?.flaky ?? 0;
    expected += e;
    unexpected += u;
    flaky += f;
    if (u === 0 && f === 0) passingRuns++;
    if (typeof r.duration === 'number' && r.duration > 0) {
      durationSum += r.duration;
      durationDenom++;
    }
  }
  const executed = expected + unexpected + flaky;
  const passRatePct = executed > 0 ? (expected / executed) * 100 : 0;
  return {
    runs: reports.length,
    passingRuns,
    passRatePct,
    flakyCount: flaky,
    failureCount: unexpected + flaky,
    avgRunDurationMs: durationDenom > 0 ? durationSum / durationDenom : 0,
  };
}

async function computeProjectTrendSignal(
  currentWindow: Array<TrendReportLike & { reportID: string; createdAt: string | Date }>,
  project: string,
  currentClusters: ProjectCluster[],
  priorReports: Array<TrendReportLike & { reportID: string; createdAt: string | Date }>
): Promise<ProjectTrendSignal | undefined> {
  if (currentWindow.length === 0) return undefined;
  const current = summarizeReportsForTrend(currentWindow);

  const prior = priorReports.length > 0 ? summarizeReportsForTrend(priorReports) : undefined;

  let splits: ProjectTrendSignal['splits'];
  if (currentWindow.length >= 4) {
    const halfSize = Math.floor(currentWindow.length / 2);
    const lastHalf = currentWindow.slice(0, halfSize);
    const firstHalf = currentWindow.slice(currentWindow.length - halfSize);
    const lastSum = summarizeReportsForTrend(lastHalf);
    const firstSum = summarizeReportsForTrend(firstHalf);
    splits = {
      halfSize,
      lastHalfFailures: lastSum.failureCount,
      firstHalfFailures: firstSum.failureCount,
    };
  }

  let clusterFlow: ProjectTrendSignal['clusterFlow'];
  if (priorReports.length > 0) {
    const priorClusters = await aggregateProjectClusters(
      priorReports.map((r) => ({
        reportId: r.reportID,
        createdAt: String(r.createdAt),
        displayNumber: r.displayNumber,
      })),
      project,
      { topN: 50 }
    );
    const currentKeys = new Set(currentClusters.map((c) => c.stableKey));
    const priorKeys = new Set(priorClusters.map((c) => c.stableKey));
    const resolved = priorClusters.filter((c) => !currentKeys.has(c.stableKey));
    const persisting = priorClusters.filter((c) => currentKeys.has(c.stableKey));
    const newCount = currentClusters.filter((c) => !priorKeys.has(c.stableKey)).length;
    resolved.sort((a, b) => {
      if (b.reportsAffected !== a.reportsAffected) return b.reportsAffected - a.reportsAffected;
      return b.occurrences - a.occurrences;
    });
    clusterFlow = {
      resolvedCount: resolved.length,
      persistingCount: persisting.length,
      newCount,
      topResolved: resolved.slice(0, 3).map((c) => ({
        kind: c.kind,
        category: c.category,
        reportsAffected: c.reportsAffected,
        sampleTest: c.affectedTests[0]?.title,
      })),
    };
  }

  return { current, prior, splits, clusterFlow };
}

export async function processProjectSummary(task: LlmTaskRow): Promise<void> {
  const { project, reportIds: reportIdsJson } = task;
  if (!project) {
    llmTasksDb.fail(task.id, 'Missing project');
    return;
  }

  const explicitReportIds = (() => {
    if (!reportIdsJson) return null;
    try {
      const parsed = JSON.parse(reportIdsJson);
      return Array.isArray(parsed) && parsed.every((x: unknown) => typeof x === 'string')
        ? (parsed as string[])
        : null;
    } catch {
      return null;
    }
  })();

  let latestReports: ReturnType<typeof reportDb.getLatestByProject>;
  if (explicitReportIds && explicitReportIds.length > 0) {
    latestReports = explicitReportIds
      .map((rid) => reportDb.getByID(rid))
      .filter((r): r is NonNullable<typeof r> => !!r);
  } else {
    const projectArg = project === 'all' ? undefined : project;
    latestReports = reportDb.getLatestByProject(projectArg, PROJECT_SUMMARY_REPORT_LIMIT);
  }
  if (latestReports.length === 0) {
    llmTasksDb.fail(task.id, 'No reports found for project');
    return;
  }

  const failureSummaryMap = new Map(
    failureSummaryDb
      .getSummariesByProject(project, PROJECT_SUMMARY_REPORT_LIMIT)
      .map((s) => [s.reportId, s] as const)
  );

  const clusters = await aggregateProjectClusters(
    latestReports.map((r) => ({
      reportId: r.reportID,
      createdAt: String(r.createdAt),
      displayNumber: r.displayNumber,
    })),
    project,
    { topN: 10 }
  );

  const oldestReportCreatedAt = latestReports.length
    ? String(latestReports[latestReports.length - 1].createdAt)
    : '';
  const latestReportCreatedAt = latestReports.length ? String(latestReports[0].createdAt) : '';
  const priorReports = oldestReportCreatedAt
    ? reportDb.getLatestByProjectBefore(
        project === 'all' ? undefined : project,
        oldestReportCreatedAt,
        latestReports.length
      )
    : [];

  const trendSignal = await computeProjectTrendSignal(
    latestReports,
    project,
    clusters,
    priorReports
  );

  const coverage = computeProjectCoverageScope(
    latestReports.map((r) => r.reportID),
    priorReports.length > 0 ? priorReports.map((r) => r.reportID) : null,
    oldestReportCreatedAt,
    latestReportCreatedAt,
    project
  );

  const projectConfig = await service.getConfig();
  const projectLlmCfg = projectConfig.llm ?? {};
  const regressionsAggregate = regressionsDb.aggregateForAnalytics({
    project: project === 'all' ? undefined : project,
    since: oldestReportCreatedAt,
    until: latestReportCreatedAt,
  });
  const builtPrompt = buildProjectSummarySegments({
    project,
    runs: latestReports.map((r) => {
      const summary = failureSummaryMap.get(r.reportID);
      return {
        reportId: r.reportID,
        displayNumber: r.displayNumber,
        createdAt: String(r.createdAt),
        stats: {
          total: r.stats?.total ?? 0,
          expected: r.stats?.expected ?? 0,
          unexpected: r.stats?.unexpected ?? 0,
          flaky: r.stats?.flaky ?? 0,
          skipped: r.stats?.skipped ?? 0,
        },
        totalFailures: summary?.totalFailures ?? 0,
        categories: summary?.categories ?? {},
        llmSummary: summary?.llmSummary ?? undefined,
        runContext: buildRunContextFromReport(r as unknown as Record<string, unknown>),
      };
    }),
    clusters,
    trendSignal,
    coverage,
    regressions: regressionsAggregate,
    overrides: {
      systemPrompt: projectLlmCfg.customSystemPrompt,
      projectSummarySystemPrompt: projectLlmCfg.customProjectSummarySystemPrompt,
      projectSummaryInstructions: projectLlmCfg.customProjectSummaryInstructions,
      generalContext: projectLlmCfg.generalContext,
    },
  });

  await llmService.initialize();
  const { prompt: segmentedPrompt, log: fitLog } = await fitToContextWindow(
    builtPrompt,
    OUTPUT_RESERVE_TOKENS_BY_TASK.projectSummary
  );

  const debugPrompt = renderSegmentsForDebug(segmentedPrompt);
  llmTasksDb.updatePrompt(
    task.id,
    debugPrompt,
    llmService.estimateLocalInputTokens(segmentedPrompt)
  );
  if (fitLog) console.log(`[llmQueue] Task ${task.id}: ${fitLog}`);

  const projectTemp =
    projectLlmCfg.projectSummaryTemperature ?? TASK_TEMPERATURE_DEFAULTS.projectSummary;
  const response = await llmService.sendSegmentedMessage(segmentedPrompt, {
    temperature: projectTemp,
  });

  const validReportIds = new Set(latestReports.map((r) => r.reportID));
  const validTestIds = new Set<string>();
  for (const c of clusters) {
    for (const t of c.affectedTests) validTestIds.add(t.testId);
  }

  const linkified = linkifyDataBlockTags(response.content, {
    validTestIds,
    validReportIds,
    project: project === 'all' ? undefined : project,
  });

  let structured = parseProjectAnalysisFromText(linkified);

  if (structured) {
    structured = pruneInvalidCodeRefs(structured, validTestIds, validReportIds);

    if (project !== 'all') {
      structured = {
        ...structured,
        sections: structured.sections.map((section) =>
          section.codeRefs
            ? {
                ...section,
                codeRefs: section.codeRefs.map((ref) =>
                  ref.kind === 'test' ? { ...ref, project } : ref
                ),
              }
            : section
        ),
      };
    }

    structured = { ...structured, latestReportId: latestReports[0]?.reportID };
  }

  const summaryText = structured ? renderProjectAnalysisAsMarkdown(structured) : response.content;
  const structuredJson = structured ? JSON.stringify(structured) : null;

  llmTasksDb.complete(task.id, summaryText, null, response.model, {
    usage: response.usage,
    baseUrl: llmService.getBaseUrl(),
  });

  const reportTimes = latestReports
    .map((r) => (r.createdAt ? new Date(String(r.createdAt)).getTime() : Number.NaN))
    .filter((t) => Number.isFinite(t)) as number[];
  projectSummaryDb.upsert({
    project,
    summary: summaryText,
    structured: structuredJson,
    model: response.model,
    lastReportId: latestReports[0]?.reportID,
    reportCount: latestReports.length,
    firstReportAt: reportTimes.length
      ? new Date(Math.min(...reportTimes)).toISOString()
      : undefined,
    lastReportAt: reportTimes.length ? new Date(Math.max(...reportTimes)).toISOString() : undefined,
  });
}

import type { LLMConfig } from '@playwright-reports/shared';
import { getFailureClusters } from '../../../failure-clustering/index.js';
import {
  failureSummaryDb,
  type LlmTaskRow,
  llmTasksDb,
  testAnalysisDb,
  testDb,
} from '../../../service/db/index.js';
import { reportDb } from '../../../service/db/reports.sqlite.js';
import { service } from '../../../service/index.js';
import { compareReports, findPreviousReportInProject } from '../../../service/reportCompare.js';
import { llmService } from '../../index.js';
import type { ReportSummaryTrendContext } from '../../prompts/index.js';
import { buildReportSummarySegments, renderSegmentsForDebug } from '../../prompts/index.js';
import {
  parseReportAnalysisFromText,
  renderReportAnalysisAsMarkdown,
} from '../../reportAnalysis.js';
import {
  fitToContextWindow,
  OUTPUT_RESERVE_TOKENS_BY_TASK,
  TASK_TEMPERATURE_DEFAULTS,
} from './promptFitting.js';
import { buildRunContextFromReport } from './reportEnrichment.js';

const MAX_TREND_LIST_ITEMS = 25;

const AUTO_PROJECT_SUMMARY_PRIORITY = -10;

type ReportFailureRecord = {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath?: string;
  category: string;
  errorSignature?: string;
  message: string;
};

type FailingByKey = Map<string, ReportFailureRecord>;
type AnalysisByKey = Map<string, { category: string; analysis: string }>;

function collectPerTestAnalyses(reportId: string): AnalysisByKey {
  const rows = testAnalysisDb.getByReport(reportId);
  const out: AnalysisByKey = new Map();
  for (const ta of rows) {
    const key = `${ta.testId}::${ta.fileId}::${ta.project}`;
    out.set(key, {
      category: ta.category || 'unknown',
      analysis: ta.analysis || '',
    });
  }
  return out;
}

function partitionFailingRunsByOutcome(reportId: string): {
  hardFailingByKey: FailingByKey;
  flakyByKey: FailingByKey;
} {
  const reportRuns = testDb.getTestRunsByReport(reportId);
  const hardFailingByKey: FailingByKey = new Map();
  const flakyByKey: FailingByKey = new Map();
  const failing = reportRuns.filter(
    (run) => run.outcome === 'unexpected' || run.outcome === 'failed' || run.outcome === 'flaky'
  );
  const testInfoByKey = testDb.getTestsByKeys(
    failing.map((run) => ({ testId: run.testId, fileId: run.fileId, project: run.project }))
  );
  for (const run of failing) {
    const isHardFail = run.outcome === 'unexpected' || run.outcome === 'failed';
    let message = '';
    if (run.failureDetails) {
      try {
        const parsed = JSON.parse(run.failureDetails);
        message = String(parsed?.message ?? '');
      } catch {
        // ignore — empty message
      }
    }
    const key = `${run.testId}::${run.fileId}::${run.project}`;
    const test = testInfoByKey.get(key);
    const rec: ReportFailureRecord = {
      testId: run.testId,
      fileId: run.fileId,
      project: run.project,
      title: test?.title ?? run.testId,
      filePath: test?.filePath,
      category: run.failureCategory ?? 'unknown',
      errorSignature: run.errorSignature ?? undefined,
      message,
    };
    const target = isHardFail ? hardFailingByKey : flakyByKey;
    if (!target.has(key)) target.set(key, rec);
  }
  return { hardFailingByKey, flakyByKey };
}

function shapeClustersForPrompt(args: {
  clusterReport: Awaited<
    ReturnType<typeof import('../../../failure-clustering/index.js').getFailureClusters>
  >;
  hardFailingByKey: FailingByKey;
  flakyByKey: FailingByKey;
  analysisByTest: AnalysisByKey;
  trendContext: ReportSummaryTrendContext | undefined;
}) {
  const { clusterReport, hardFailingByKey, flakyByKey, analysisByTest, trendContext } = args;

  type Trend = 'newlyFailed' | 'stillFailing' | 'unknown';
  const trendByTitleFile = new Map<string, Trend>();
  if (trendContext) {
    const mkKey = (t: { title: string; filePath: string }) => `${t.title}::${t.filePath}`;
    for (const t of trendContext.newlyFailed) trendByTitleFile.set(mkKey(t), 'newlyFailed');
    for (const t of trendContext.stillFailing) trendByTitleFile.set(mkKey(t), 'stillFailing');
  }
  const trendFor = (title: string, filePath?: string): Trend =>
    trendContext ? (trendByTitleFile.get(`${title}::${filePath ?? ''}`) ?? 'unknown') : 'unknown';

  const realClusters = clusterReport.clusters.filter((c) => c.anchor.kind !== 'unmatched');

  const clusters = realClusters.map((c) => {
    const members = c.tests.map((t) => {
      const key = `${t.testId}::${t.fileId}::${t.project}`;
      const rec = hardFailingByKey.get(key);
      const a = analysisByTest.get(key);
      const inThisReport = !!rec;
      return {
        testId: t.testId,
        fileId: t.fileId,
        project: t.project,
        title: t.title,
        filePath: t.filePath,
        inThisReport,
        category: rec?.category ?? a?.category ?? c.category,
        message: rec?.message ?? '',
        analysis: a?.analysis ?? '',
        occurrences: t.occurrences,
        trend: inThisReport ? trendFor(t.title, t.filePath) : undefined,
      };
    });
    return {
      id: c.id,
      kind: c.anchor.kind,
      name: c.name,
      category: c.category,
      sampleMessage: c.sampleMessage,
      testCount: c.testCount,
      failureCount: c.failureCount,
      anchor: c.anchor,
      members,
    };
  });

  const clusteredKeys = new Set<string>();
  for (const c of realClusters) {
    for (const t of c.tests) {
      clusteredKeys.add(`${t.testId}::${t.fileId}::${t.project}`);
    }
  }

  const unclustered: Array<ReportFailureRecord & { analysis: string; trend: Trend }> = [];
  for (const [key, rec] of hardFailingByKey) {
    if (clusteredKeys.has(key)) continue;
    const a = analysisByTest.get(key);
    unclustered.push({
      ...rec,
      analysis: a?.analysis ?? '',
      trend: trendFor(rec.title, rec.filePath),
    });
  }

  const flakyTests = Array.from(flakyByKey.values()).map((rec) => {
    const key = `${rec.testId}::${rec.fileId}::${rec.project}`;
    const a = analysisByTest.get(key);
    return { ...rec, analysis: a?.analysis ?? '' };
  });

  const categories: Record<string, number> = {};
  for (const [key, rec] of hardFailingByKey) {
    const a = analysisByTest.get(key);
    const cat = a?.category || rec.category || 'unknown';
    categories[cat] = (categories[cat] ?? 0) + 1;
  }

  return { clusters, unclustered, flakyTests, categories };
}

async function buildTrendContextForReport(
  reportId: string
): Promise<ReportSummaryTrendContext | undefined> {
  const current = reportDb.getByID(reportId);
  if (!current) return undefined;

  const previous = findPreviousReportInProject(current.project, current.createdAt, reportId);
  if (!previous) return undefined;

  const { result, error } = compareReports(previous.reportID, reportId);
  if (error || !result) {
    console.warn(`[llmQueue] trend context skipped for ${reportId}: ${error ?? 'unknown'}`);
    return undefined;
  }

  const trimEntry = (e: { title: string; filePath: string }) => ({
    title: e.title,
    filePath: e.filePath,
  });

  return {
    previousReport: {
      reportId: result.reportA.reportID,
      title: result.reportA.title,
      displayNumber: result.reportA.displayNumber,
      createdAt: result.reportA.createdAt,
    },
    counts: {
      newlyFailed: result.summary.newlyFailedCount,
      fixed: result.summary.fixedCount,
      stillFailing: result.summary.stillFailingCount,
      newTests: result.summary.newTestsCount,
      removedTests: result.summary.removedTestsCount,
      durationRegressions: result.summary.durationRegressionsCount,
      durationImprovements: result.summary.durationImprovementsCount,
    },
    newlyFailed: result.newlyFailed.slice(0, MAX_TREND_LIST_ITEMS).map(trimEntry),
    fixed: result.fixed.slice(0, MAX_TREND_LIST_ITEMS).map(trimEntry),
    stillFailing: result.stillFailing.slice(0, MAX_TREND_LIST_ITEMS).map(trimEntry),
    topDurationRegressions: result.durationDeltas
      .filter((d) => d.deltaMs > 0)
      .slice(0, MAX_TREND_LIST_ITEMS)
      .map((d) => ({
        title: d.title,
        filePath: d.filePath,
        durationA: d.durationA,
        durationB: d.durationB,
        deltaMs: d.deltaMs,
        deltaPct: d.deltaPct,
      })),
  };
}

export async function processReportSummary(task: LlmTaskRow): Promise<void> {
  const { reportId, project } = task;
  if (!reportId) {
    llmTasksDb.fail(task.id, 'Missing reportId');
    return;
  }

  if (!llmTasksDb.areAllTestTasksComplete(reportId)) {
    if (task.retryCount >= 20) {
      llmTasksDb.fail(task.id, 'Timed out waiting for test analyses to complete');
      return;
    }
    llmTasksDb.requeueWithRetryIncrement(task.id);
    console.log(
      `[llmQueue] Report summary ${task.id} requeued (${task.retryCount + 1}/20) — waiting for test analyses`
    );
    return;
  }

  const analysisByTest = collectPerTestAnalyses(reportId);
  const { hardFailingByKey, flakyByKey } = partitionFailingRunsByOutcome(reportId);

  const clusterReport = await getFailureClusters({
    project: project ?? undefined,
    reportId,
  });

  const trendContext = await buildTrendContextForReport(reportId);
  const { clusters, unclustered, flakyTests, categories } = shapeClustersForPrompt({
    clusterReport,
    hardFailingByKey,
    flakyByKey,
    analysisByTest,
    trendContext,
  });

  const currentReport = reportDb.getByID(reportId) as
    | (Record<string, unknown> & { createdAt?: string | Date })
    | undefined;
  const runContext = currentReport ? buildRunContextFromReport(currentReport) : undefined;

  const reportConfig = await service.getConfig();
  const reportLlmCfg = reportConfig.llm ?? {};
  const builtPrompt = buildReportSummarySegments({
    reportId,
    categories,
    clusters,
    unclustered,
    flaky: flakyTests,
    runContext,
    trendContext,
    overrides: {
      systemPrompt: reportLlmCfg.customSystemPrompt,
      reportSummaryPrompt: reportLlmCfg.customReportSummaryPrompt,
      generalContext: reportLlmCfg.generalContext,
      project: project ?? undefined,
    },
  });

  await llmService.initialize();
  const { prompt: segmentedPrompt, log: fitLog } = await fitToContextWindow(
    builtPrompt,
    OUTPUT_RESERVE_TOKENS_BY_TASK.reportSummary
  );

  const debugPrompt = renderSegmentsForDebug(segmentedPrompt);
  llmTasksDb.updatePrompt(
    task.id,
    debugPrompt,
    llmService.estimateLocalInputTokens(segmentedPrompt)
  );
  if (fitLog) console.log(`[llmQueue] Task ${task.id}: ${fitLog}`);

  const reportTemp =
    reportLlmCfg.reportSummaryTemperature ?? TASK_TEMPERATURE_DEFAULTS.reportSummary;
  const response = await llmService.sendSegmentedMessage(segmentedPrompt, {
    temperature: reportTemp,
  });

  let structured = parseReportAnalysisFromText(response.content);

  if (structured) {
    structured = {
      ...structured,
      reportId,
      sections: structured.sections.map((s) => ({
        ...s,
        codeRefs: s.codeRefs?.map((ref) => ({
          ...ref,
          project: ref.project ?? project ?? undefined,
        })),
      })),
    };
  }

  const summaryText = structured ? renderReportAnalysisAsMarkdown(structured) : response.content;

  llmTasksDb.complete(task.id, summaryText, null, response.model, {
    usage: response.usage,
    baseUrl: llmService.getBaseUrl(),
  });

  const totalFailures = Object.values(categories).reduce((s, c) => s + c, 0);
  failureSummaryDb.upsertSummary(reportId, project || '', totalFailures, categories);
  failureSummaryDb.updateLlmSummary(reportId, summaryText, structured, response.model);

  await maybeEnqueueAutoProjectSummary(reportId, project, totalFailures, reportLlmCfg);
}

async function maybeEnqueueAutoProjectSummary(
  reportId: string,
  project: string | null,
  totalFailures: number,
  reportLlmCfg: LLMConfig
): Promise<void> {
  if (!reportLlmCfg?.autoProjectSummaryOnReportComplete) return;

  const hasFailures = totalFailures > 0;
  const analyzeGreen = reportLlmCfg.analyzeGreenWindows === true;
  if (!hasFailures && !analyzeGreen) {
    console.log(
      `[llmQueue] Auto project_summary skipped for report ${reportId} — all-green and analyzeGreenWindows is off`
    );
    return;
  }

  const targets = new Set<string>();
  if (project) targets.add(project);
  targets.add('all');

  const queued: string[] = [];
  const skipped: string[] = [];
  for (const projectKey of targets) {
    if (llmTasksDb.findInflightProjectSummary(projectKey)) {
      skipped.push(projectKey);
      continue;
    }
    llmTasksDb.createTask('project_summary', {
      project: projectKey,
      priority: AUTO_PROJECT_SUMMARY_PRIORITY,
    });
    queued.push(projectKey);
  }
  console.log(
    `[llmQueue] Auto project_summary after report ${reportId} — queued: ${queued.join(', ') || 'none'}; skipped (in-flight): ${skipped.join(', ') || 'none'}`
  );
}

import { FLAKINESS_THRESHOLDS } from '@playwright-reports/shared';
import { stripAnsi } from '../../../parser/failure-extraction.js';
import {
  analysisFeedbackDb,
  type LlmTaskRow,
  llmTasksDb,
  regressionsDb,
  testAnalysisDb,
  testDb,
  toRegressionContext,
} from '../../../service/db/index.js';
import { service } from '../../../service/index.js';
import {
  detectFailureCategory,
  isRootCauseCategory,
} from '../../../service/test-management/index.js';
import { llmService } from '../../index.js';
import type { FailureDetailsForPrompt } from '../../prompts/index.js';
import { buildTestFailureSegments, renderSegmentsForDebug } from '../../prompts/index.js';
import { extractTestAnalysisFromMarkdown } from '../../testAnalysis.js';
import type { SegmentedPrompt } from '../../types/index.js';
import {
  attachScreenshotIfAny,
  fitToContextWindow,
  OUTPUT_RESERVE_TOKENS_BY_TASK,
  TASK_TEMPERATURE_DEFAULTS,
} from './promptFitting.js';
import {
  areAttemptsStale,
  enrichEnvironmentFromReport,
  extractDetailsFromReport,
  isEvidenceStale,
} from './reportEnrichment.js';

const CROSS_PROJECT_CANDIDATE_POOL = 25;
const CROSS_PROJECT_KEEP = 5;
const RECENT_OUTCOMES_KEEP = 15;
const RECENT_CATEGORIES_KEEP = 8;

const REUSE_TTL_DAYS = 7;
const REUSE_RECURRENCE_LIMIT = 5;

interface ResolvedTestContext {
  testId: string;
  fileId: string;
  project: string;
  reportId: string;
  details: FailureDetailsForPrompt;
  failedRun: ReturnType<typeof testDb.getTestRuns>[number] | undefined;
  runs: ReturnType<typeof testDb.getTestRuns>;
  totalRuns: number;
  recentFailures: number;
  isNewFailure: boolean;
  feedback: ReturnType<typeof analysisFeedbackDb.getByTest>;
  heuristicCategory: string;
  currentErrorSignature: string | undefined;
}

async function resolveTestFailureContext(
  testId: string,
  fileId: string,
  project: string,
  reportId: string
): Promise<ResolvedTestContext | { error: string }> {
  const runs = testDb.getTestRuns(testId, fileId, project);
  const failedRun =
    runs.find((r) => r.failureDetails && r.reportId === reportId) ||
    runs.find((r) => r.failureDetails) ||
    runs.find((r) => r.reportId === reportId) ||
    runs[0];

  let details: FailureDetailsForPrompt;

  let parsedDetails: FailureDetailsForPrompt | null = null;

  if (failedRun?.failureDetails) {
    try {
      parsedDetails = JSON.parse(failedRun.failureDetails);
    } catch {
      // fall through to HTML extraction
    }
  }

  if (parsedDetails) {
    details = parsedDetails;
    const needsMessageEnrich = !details.message || details.message.trim() === '';
    const needsAttemptsEnrich = areAttemptsStale(details.attempts);
    const needsEvidenceEnrich = !details.evidence || isEvidenceStale(details.evidence);
    if (needsMessageEnrich || needsAttemptsEnrich || needsEvidenceEnrich) {
      const extracted = await extractDetailsFromReport(reportId, testId);
      if (extracted?.message && needsMessageEnrich) {
        details.message = extracted.message;
        details.stackTrace ??= extracted.stackTrace;
      }
      if (extracted?.attempts && needsAttemptsEnrich) {
        details.attempts = extracted.attempts;
      }
      if (extracted?.evidence && needsEvidenceEnrich) {
        details.evidence = extracted.evidence;
      }
    }
  } else {
    const extracted = await extractDetailsFromReport(reportId, testId);
    if (!extracted) {
      return { error: `No failure details found — test ${testId} not found in report ${reportId}` };
    }
    details = extracted;
  }

  if (details.message) details.message = stripAnsi(details.message);
  if (details.stackTrace) details.stackTrace = stripAnsi(details.stackTrace);

  const totalRuns = testDb.getTestRunCount(testId, fileId, project);
  const recentFailures = runs.filter(
    (r) => r.outcome === 'unexpected' || r.outcome === 'failed'
  ).length;

  const previousAnalysis = testAnalysisDb.getByTest(testId, fileId, project);
  const isNewFailure = !previousAnalysis;
  const feedback = analysisFeedbackDb.getByTest(testId, fileId, project);

  const heuristicCategory = detectFailureCategory(details.message);

  return {
    testId,
    fileId,
    project,
    reportId,
    details,
    failedRun,
    runs,
    totalRuns,
    recentFailures,
    isNewFailure,
    feedback,
    heuristicCategory,
    currentErrorSignature: failedRun?.errorSignature,
  };
}

async function buildTestAnalysisPrompt(
  ctx: ResolvedTestContext,
  logPrefix?: string
): Promise<{ segmentedPrompt: SegmentedPrompt; debugPrompt: string; fitLog: string | null }> {
  const config = await service.getConfig();
  const warningThreshold =
    config.testManagement?.warningThresholdPercentage ?? FLAKINESS_THRESHOLDS.WARNING_PERCENTAGE;
  const flakinessScore = ctx.failedRun?.flakinessScore ?? 0;
  const llmCfg = config.llm ?? {};

  const promptOverrides = {
    systemPrompt: llmCfg.customSystemPrompt,
    testAnalysisSystemPrompt: llmCfg.customTestAnalysisSystemPrompt,
    projectSummarySystemPrompt: llmCfg.customProjectSummarySystemPrompt,
    testAnalysisInstructions: llmCfg.customTestAnalysisInstructions,
    reportSummaryPrompt: llmCfg.customReportSummaryPrompt,
    projectSummaryInstructions: llmCfg.customProjectSummaryInstructions,
    generalContext: llmCfg.generalContext,
    project: ctx.project,
  };

  const { entries: crossProjectEntries, totalCount: crossProjectTotalCount } =
    buildCrossProjectEntries(
      ctx.testId,
      ctx.fileId,
      ctx.project,
      ctx.failedRun?.errorSignature ?? undefined
    );

  const { recentOutcomes, previousCategoriesChronological } = buildRecentHistoryFromRuns(ctx.runs);

  await enrichEnvironmentFromReport(ctx.details, ctx.reportId);

  const priorPrior = testAnalysisDb.getLatestPriorByTest(
    ctx.testId,
    ctx.fileId,
    ctx.project,
    ctx.reportId
  );
  const openRegression = regressionsDb.getOpenForTest(ctx.testId, ctx.fileId, ctx.project);
  const builtPrompt = buildTestFailureSegments({
    failureDetails: ctx.details,
    historicalContext: {
      totalRuns: ctx.totalRuns,
      recentFailureCount: ctx.recentFailures,
      flakinessScore,
      flakinessThreshold: warningThreshold,
      isFlaky: flakinessScore >= warningThreshold,
      isNewFailure: ctx.isNewFailure,
      recentOutcomes,
      previousCategories: previousCategoriesChronological,
    },
    feedback: ctx.feedback,
    crossProjectEntries,
    crossProjectTotalCount,
    priorInProjectAnalysis: priorPrior?.analysis
      ? {
          analysis: priorPrior.analysis,
          category: priorPrior.category ?? undefined,
          model: priorPrior.model ?? undefined,
          updatedAt: priorPrior.updatedAt ?? priorPrior.createdAt,
        }
      : null,
    regressionContext: openRegression ? toRegressionContext(openRegression) : null,
    overrides: promptOverrides,
  });

  await attachScreenshotIfAny(builtPrompt, ctx.details, ctx.reportId, logPrefix);

  await llmService.initialize();
  const { prompt: segmentedPrompt, log: fitLog } = await fitToContextWindow(
    builtPrompt,
    OUTPUT_RESERVE_TOKENS_BY_TASK.testAnalysis
  );
  const debugPrompt = renderSegmentsForDebug(segmentedPrompt);

  return { segmentedPrompt, debugPrompt, fitLog };
}

function buildCrossProjectEntries(
  testId: string,
  fileId: string,
  project: string,
  currentSignature: string | undefined
): {
  entries: Array<{
    project: string;
    comment: string;
    updatedAt: string;
    errorSignatureMatchesCurrent: boolean;
    latestAnalysis?: { content: string; updatedAt: string; model?: string };
  }>;
  totalCount: number;
} {
  const relatedRows = analysisFeedbackDb.getRelatedByTest(
    testId,
    fileId,
    project,
    CROSS_PROJECT_CANDIDATE_POOL
  );
  const score = (r: (typeof relatedRows)[number]): number => {
    const sigMatch =
      !!currentSignature && !!r.errorSignature && r.errorSignature === currentSignature;
    const ageMs = Date.now() - new Date(r.updatedAt).getTime();
    const days = Math.max(0, ageMs / (24 * 60 * 60 * 1000));
    return (sigMatch ? 100 : 0) + 30 / (1 + days) + (r.latestAnalysis ? 5 : 0);
  };
  const ranked = [...relatedRows]
    .map((r) => ({ row: r, s: score(r) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, CROSS_PROJECT_KEEP)
    .map(({ row: r }) => r);
  const entries = ranked.map((r) => ({
    project: r.project,
    comment: r.comment,
    updatedAt: r.updatedAt,
    errorSignatureMatchesCurrent:
      !!currentSignature && !!r.errorSignature && r.errorSignature === currentSignature,
    latestAnalysis: r.latestAnalysis
      ? {
          content: r.latestAnalysis,
          updatedAt: r.latestAnalysisUpdatedAt ?? r.updatedAt,
          model: r.latestAnalysisModel ?? undefined,
        }
      : undefined,
  }));
  return { entries, totalCount: relatedRows.length };
}

function buildRecentHistoryFromRuns(runs: ReturnType<typeof testDb.getTestRuns>): {
  recentOutcomes: string[];
  previousCategoriesChronological: string[];
} {
  const recentOutcomes = runs.slice(0, RECENT_OUTCOMES_KEEP).map((r) => r.outcome);
  const previousCategoriesChronological = runs
    .map((r) => r.failureCategory)
    .filter((c): c is string => !!c)
    .slice(0, RECENT_CATEGORIES_KEEP);
  return { recentOutcomes, previousCategoriesChronological };
}

export async function processTestAnalysis(task: LlmTaskRow): Promise<void> {
  const { testId, fileId, project, reportId } = task;
  if (!testId || !fileId || !project || !reportId) {
    llmTasksDb.fail(task.id, 'Missing testId, fileId, project, or reportId');
    return;
  }

  const resolved = await resolveTestFailureContext(testId, fileId, project, reportId);
  if ('error' in resolved) {
    llmTasksDb.fail(task.id, resolved.error);
    return;
  }

  const existingForThisReport = testAnalysisDb.getByTestAndReport(testId, reportId);
  const hasNonEmptyExisting =
    !!existingForThisReport?.analysis && existingForThisReport.analysis.trim().length > 0;

  if (!task.isRetry && !hasNonEmptyExisting && resolved.currentErrorSignature) {
    const reuseSource = testAnalysisDb.findReuseSource(
      testId,
      fileId,
      project,
      resolved.currentErrorSignature,
      resolved.heuristicCategory,
      reportId
    );

    if (reuseSource) {
      const sourceUpdatedAt = reuseSource.updatedAt || reuseSource.createdAt;
      const feedbackIsNewer =
        resolved.feedback &&
        sourceUpdatedAt &&
        new Date(resolved.feedback.updatedAt).getTime() > new Date(sourceUpdatedAt).getTime();

      const ageMs = sourceUpdatedAt ? Date.now() - new Date(sourceUpdatedAt).getTime() : 0;
      const ttlExpired = ageMs > REUSE_TTL_DAYS * 24 * 60 * 60 * 1000;

      let recurrenceExceeded = false;
      if (sourceUpdatedAt) {
        const recurrenceCount = testDb.countRunsWithSignatureSince(
          testId,
          fileId,
          project,
          resolved.currentErrorSignature,
          sourceUpdatedAt
        );
        recurrenceExceeded = recurrenceCount > REUSE_RECURRENCE_LIMIT;
      }

      if (ttlExpired) {
        console.log(
          `[llmQueue] Task ${task.id}: source analysis older than ${REUSE_TTL_DAYS}d — forcing fresh analysis for test ${testId}`
        );
      } else if (recurrenceExceeded) {
        console.log(
          `[llmQueue] Task ${task.id}: signature recurred >${REUSE_RECURRENCE_LIMIT} times since source analysis — forcing fresh analysis for test ${testId}`
        );
      } else if (feedbackIsNewer) {
        console.log(
          `[llmQueue] Task ${task.id}: feedback newer than source analysis — forcing fresh analysis for test ${testId}`
        );
      } else {
        console.log(
          `[llmQueue] Task ${task.id}: error_signature + category match (source ${reuseSource.id}), reusing for test ${testId}`
        );
        const attempt = resolved.details.attempt ?? 1;
        const reuseExtras = {
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        };
        llmTasksDb.complete(
          task.id,
          reuseSource.analysis,
          reuseSource.category ?? undefined,
          reuseSource.model ?? undefined,
          reuseExtras
        );
        testAnalysisDb.upsert(
          testId,
          fileId,
          project,
          reportId,
          reuseSource.analysis,
          reuseSource.category ?? undefined,
          reuseSource.model ?? undefined,
          attempt,
          reuseSource.id,
          reuseExtras
        );

        if (resolved.failedRun?.runId && reuseSource.category) {
          testDb.updateFailureCategory(resolved.failedRun.runId, reuseSource.category);
        }

        if (reportId && llmTasksDb.areAllTestTasksComplete(reportId)) {
          console.log(`[llmQueue] All test analyses for report ${reportId} complete`);
        }
        return;
      }
    }
  }

  const { segmentedPrompt, debugPrompt, fitLog } = await buildTestAnalysisPrompt(
    resolved,
    `[llmQueue] Task ${task.id}`
  );

  llmTasksDb.updatePrompt(
    task.id,
    debugPrompt,
    llmService.estimateLocalInputTokens(segmentedPrompt)
  );

  console.log(
    `[llmQueue] Task ${task.id}: segments=${segmentedPrompt.segments.length} chars=${debugPrompt.length} for test ${testId}${fitLog ? ` ${fitLog}` : ''}`
  );

  const config = await service.getConfig();
  const llmCfg = config.llm ?? {};
  const testAnalysisTemp = llmCfg.testAnalysisTemperature ?? TASK_TEMPERATURE_DEFAULTS.testAnalysis;
  const response = await llmService.sendSegmentedMessage(segmentedPrompt, {
    temperature: testAnalysisTemp,
  });

  const { analysis: analysisText, category: llmCategory } = extractTestAnalysisFromMarkdown(
    response.content
  );

  if (!analysisText) {
    console.warn(
      `[llmQueue] Task ${task.id}: empty analysis after extraction ` +
        `(contentChars=${response.content.length}, ` +
        `category=${llmCategory ?? 'none'}, model=${response.model || 'unknown'}, ` +
        `outputTokens=${response.usage?.outputTokens ?? 'n/a'}). Raw head: ` +
        JSON.stringify(response.content.slice(0, 400))
    );
    llmTasksDb.fail(task.id, `LLM returned empty analysis`);
    return;
  }

  let category: string = resolved.heuristicCategory;
  let categorySource: 'heuristic' | 'llm' = 'heuristic';
  if (llmCategory && isRootCauseCategory(llmCategory) && llmCategory !== 'unknown') {
    category = llmCategory;
    categorySource = 'llm';
  }

  const attempt = resolved.details.attempt ?? 1;
  const completionExtras = {
    usage: response.usage,
    baseUrl: llmService.getBaseUrl(),
  };
  llmTasksDb.complete(task.id, analysisText, category, response.model, completionExtras);
  testAnalysisDb.upsert(
    testId,
    fileId,
    project,
    reportId,
    analysisText,
    category,
    response.model,
    attempt,
    undefined,
    completionExtras
  );

  if (resolved.failedRun?.runId) {
    testDb.updateFailureCategory(resolved.failedRun.runId, category, categorySource);
  }

  if (reportId && llmTasksDb.areAllTestTasksComplete(reportId)) {
    console.log(`[llmQueue] All test analyses for report ${reportId} complete`);
  }
}

export interface TestAnalysisRequest {
  segmentedPrompt: SegmentedPrompt;
  debugPrompt: string;
  heuristicCategory: string;
  details: FailureDetailsForPrompt;
  failedRun: ReturnType<typeof testDb.getTestRuns>[number] | undefined;
  fitLog: string | null;
}

export async function buildTestAnalysisRequest(opts: {
  testId: string;
  fileId: string;
  project: string;
  reportId: string;
}): Promise<TestAnalysisRequest | { error: string }> {
  const resolved = await resolveTestFailureContext(
    opts.testId,
    opts.fileId,
    opts.project,
    opts.reportId
  );
  if ('error' in resolved) {
    return resolved;
  }

  const { segmentedPrompt, debugPrompt, fitLog } = await buildTestAnalysisPrompt(resolved);

  return {
    segmentedPrompt,
    debugPrompt,
    heuristicCategory: resolved.heuristicCategory,
    details: resolved.details,
    failedRun: resolved.failedRun,
    fitLog,
  };
}

export { applyMustache, renderSegmentsForDebug, resolveSystemPrompt } from './assembleSegments.js';

export { describeGroupKind, renderAnchorInline, renderTrendLabel } from './clusterRendering.js';
export {
  PROJECT_SUMMARY_SYSTEM_PROMPT,
  PROJECT_SUMMARY_TASK_INSTRUCTIONS,
  PROJECT_SUMMARY_VARS,
} from './projectSummary/instructions.js';
export type {
  ClusterFlow,
  ProjectCluster,
  ProjectCoverageScope,
  ProjectNearFlake,
  ProjectTrendSignal,
  ProjectTrendWindow,
} from './projectSummary/segments.js';
export { buildProjectSummarySegments } from './projectSummary/segments.js';

export type { PromptFitResult } from './promptBudget.js';
export { fitPromptToBudget } from './promptBudget.js';
export type {
  CustomPromptOverrides,
  MustacheSubstitution,
  ReportSummaryRunContext,
  RunContext,
} from './promptTypes.js';
export {
  REPORT_SUMMARY_SYSTEM_PROMPT,
  REPORT_SUMMARY_TASK_INSTRUCTIONS,
  REPORT_SUMMARY_VARS,
} from './reportSummary/instructions.js';
export type {
  ReportSummaryCluster,
  ReportSummaryClusterKind,
  ReportSummaryClusterMember,
  ReportSummaryFlakyTest,
  ReportSummaryTrendContext,
  ReportSummaryTrendStatus,
  ReportSummaryUnclusteredFailure,
} from './reportSummary/segments.js';
export { buildReportSummarySegments } from './reportSummary/segments.js';
export {
  TEST_ANALYSIS_SYSTEM_PROMPT,
  TEST_ANALYSIS_TASK_INSTRUCTIONS,
  TEST_ANALYSIS_VARS,
} from './testAnalysis/instructions.js';
export type {
  AttemptSummary,
  FailureDetailsForPrompt,
  HistoricalContextInput,
  PriorInProjectAnalysis,
} from './testAnalysis/segments.js';
export {
  buildCrossProjectContext,
  buildFeedbackContext,
  buildPerTestFeedbackContext,
  buildTestFailureSegments,
  extractRootCauseParagraph,
} from './testAnalysis/segments.js';

export {
  stableStringify,
  truncateMiddle,
  unescapeLiteralNewlines,
} from './textTransforms.js';

export { PROJECT_VERDICT_ENUM, REPORT_VERDICT_ENUM } from './verdicts.js';

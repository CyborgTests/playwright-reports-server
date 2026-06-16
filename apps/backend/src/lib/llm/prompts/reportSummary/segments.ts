import type { ClusterAnchorKind } from '@playwright-reports/shared';
import type { SegmentedPrompt } from '../../types/index.js';
import {
  applyMustache,
  assembleSegments,
  buildGeneralContextSegment,
  buildSegment,
  resolveSystemPrompt,
  splitTaskInstructions,
} from '../assembleSegments.js';
import { describeGroupKind, renderAnchorInline, renderTrendLabel } from '../clusterRendering.js';
import type { CustomPromptOverrides, RunContext } from '../promptTypes.js';
import { extractRootCauseParagraph, truncateMiddle } from '../textTransforms.js';
import {
  REPORT_SUMMARY_SYSTEM_PROMPT,
  REPORT_SUMMARY_TASK_INSTRUCTIONS,
  REPORT_SUMMARY_VARS,
} from './instructions.js';

const MEMBER_MESSAGE_MAX_CHARS = 600;
const SAMPLE_MESSAGE_MAX_CHARS = 800;

export type ReportSummaryTrendStatus = 'newlyFailed' | 'stillFailing' | 'unknown';
export type ReportSummaryClusterKind = ClusterAnchorKind;

export interface ReportSummaryTrendContext {
  previousReport: {
    reportId: string;
    title?: string;
    displayNumber?: number;
    createdAt: string;
  };
  counts: {
    newlyFailed: number;
    fixed: number;
    stillFailing: number;
    newTests: number;
    removedTests: number;
    durationRegressions: number;
    durationImprovements: number;
  };
  newlyFailed: Array<{ title: string; filePath: string }>;
  fixed: Array<{ title: string; filePath: string }>;
  stillFailing: Array<{ title: string; filePath: string }>;
  topDurationRegressions: Array<{
    title: string;
    filePath: string;
    durationA: number;
    durationB: number;
    deltaMs: number;
    deltaPct: number;
  }>;
}

export interface ReportSummaryClusterMember {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath?: string;
  inThisReport: boolean;
  category?: string;
  message: string;
  analysis: string;
  occurrences: number;
  trend?: ReportSummaryTrendStatus;
}

export interface ReportSummaryCluster {
  id: string;
  kind: ReportSummaryClusterKind;
  name: string;
  category?: string;
  sampleMessage: string;
  testCount: number;
  failureCount: number;
  anchor: import('@playwright-reports/shared').ClusterAnchor;
  members: ReportSummaryClusterMember[];
}

export interface ReportSummaryUnclusteredFailure {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath?: string;
  category: string;
  errorSignature?: string;
  message: string;
  analysis: string;
  trend?: ReportSummaryTrendStatus;
}

export interface ReportSummaryFlakyTest {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath?: string;
  category: string;
  errorSignature?: string;
  message: string;
  analysis: string;
}

const formatMs = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m ${rem}s`;
};

function topDirectory(filePath: string): string {
  if (!filePath) return '.';
  const norm = filePath.replace(/\\/g, '/');
  const parts = norm.split('/').filter(Boolean);
  if (parts.length === 0) return '.';
  if (parts.length === 1) return parts[0];
  return `${parts[0]}/${parts[1]}`;
}

function computeTrendInsights(
  newlyFailed: Array<{ title: string; filePath: string }>,
  perTestAnalyses: Array<{ testTitle: string; category: string; analysis: string }>
): string[] {
  if (newlyFailed.length < 2) return [];

  const total = newlyFailed.length;
  const out: string[] = [];

  const dirCounts = new Map<string, number>();
  for (const t of newlyFailed) {
    const dir = topDirectory(t.filePath);
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }
  const [topDir, topDirCount] = [...dirCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topDirCount / total >= 0.5 && topDirCount >= 2) {
    out.push(
      `- **${topDirCount} of ${total}** new failures are in \`${topDir}/\` — likely shared root cause in that area.`
    );
  }

  const categoryByTitle = new Map<string, string>();
  for (const a of perTestAnalyses) {
    if (a.category) categoryByTitle.set(a.testTitle, a.category);
  }
  const catCounts = new Map<string, number>();
  let lookedUp = 0;
  for (const t of newlyFailed) {
    const c = categoryByTitle.get(t.title);
    if (!c) continue;
    lookedUp++;
    catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  }
  if (lookedUp >= 2) {
    const [topCat, topCatCount] = [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topCatCount / lookedUp >= 0.5 && topCatCount >= 2) {
      out.push(
        `- **${topCatCount} of ${lookedUp}** new failures share category \`${topCat}\` — likely one regression surfacing across multiple tests.`
      );
    }
  }

  return out;
}

function buildRunContextBlock(ctx: RunContext | undefined): string {
  if (!ctx) return '';
  const lines: string[] = [];
  if (ctx.gitCommit) {
    const parts: string[] = [];
    if (ctx.gitCommit.branch) parts.push(`branch \`${ctx.gitCommit.branch}\``);
    if (ctx.gitCommit.shortHash || ctx.gitCommit.hash) {
      parts.push(`commit \`${ctx.gitCommit.shortHash ?? ctx.gitCommit.hash}\``);
    }
    if (ctx.gitCommit.subject) parts.push(`subject "${ctx.gitCommit.subject}"`);
    if (parts.length > 0) lines.push(`- Git: ${parts.join(' · ')}`);
  }
  if (ctx.ci) {
    const ciParts: string[] = [];
    if (ctx.ci.buildHref) ciParts.push(`build ${ctx.ci.buildHref}`);
    if (ctx.ci.commitHref) ciParts.push(`commit ${ctx.ci.commitHref}`);
    if (!ctx.ci.buildHref && !ctx.ci.commitHref && ctx.ci.commitHash) {
      ciParts.push(`commit \`${ctx.ci.commitHash}\``);
    }
    if (ciParts.length > 0) lines.push(`- CI: ${ciParts.join(' · ')}`);
  }
  const envParts: string[] = [];
  if (ctx.playwrightVersion) envParts.push(`Playwright ${ctx.playwrightVersion}`);
  if (typeof ctx.actualWorkers === 'number') envParts.push(`${ctx.actualWorkers} workers`);
  if (envParts.length > 0) lines.push(`- Env: ${envParts.join(' · ')}`);
  if (ctx.createdAt) lines.push(`- Run timestamp: ${ctx.createdAt}`);
  if (lines.length === 0) return '';
  return `## Run Context\n${lines.join('\n')}\n`;
}

function buildReportHeaderBlock(reportId: string, totalFailures: number): string {
  return `## Report: ${reportId}\n\n## Failure Count\n${totalFailures} hard failures (flaky tests are listed separately below and do NOT count toward this total).`;
}

function buildFailureGroupsBlock(clusters: ReportSummaryCluster[]): string {
  if (clusters.length === 0) return '';
  let block = `## Failure Groups (${clusters.length})\n\n`;
  for (const cluster of clusters) {
    const kindLabel = describeGroupKind(cluster.kind);
    block += `### ${kindLabel}: ${cluster.name}\n`;
    const factsParts: string[] = [];
    if (cluster.category) factsParts.push(`category: \`${cluster.category}\``);
    factsParts.push(`${cluster.testCount} tests`);
    factsParts.push(`${cluster.failureCount} failures (window)`);
    block += `- ${factsParts.join(' · ')}\n`;
    const anchorLine = renderAnchorInline(cluster.anchor);
    if (anchorLine) block += `- Fix target: ${anchorLine}\n`;
    if (cluster.sampleMessage) {
      block += `- Sample error:\n\`\`\`\n${truncateMiddle(cluster.sampleMessage, SAMPLE_MESSAGE_MAX_CHARS)}\n\`\`\`\n`;
    }
    const membersInRun = cluster.members.filter((m) => m.inThisReport);
    const membersHistorical = cluster.members.filter((m) => !m.inThisReport);
    block += `\n#### Tests in this group that failed in this report (${membersInRun.length})\n`;
    if (membersInRun.length === 0) {
      block += `_None of this group's tests failed in this report._\n`;
    }
    for (const m of membersInRun) {
      const fileSuffix = m.filePath ? ` (${m.filePath})` : '';
      const catLabel = m.category ? ` [${m.category}]` : '';
      const trendLabel = renderTrendLabel(m.trend);
      block += `- **${m.title}** [testId: ${m.testId}]${catLabel}${fileSuffix}${trendLabel}\n`;
      if (m.message) {
        const indentedMessage = truncateMiddle(m.message, MEMBER_MESSAGE_MAX_CHARS).replace(
          /\n/g,
          '\n    '
        );
        block += `    Error: ${indentedMessage}\n`;
      }
      if (m.analysis) {
        const rootCause = extractRootCauseParagraph(m.analysis);
        const indented = rootCause.replace(/\n/g, '\n    ');
        block += `    Per-test analysis:\n    ${indented}\n`;
      }
    }
    if (membersHistorical.length > 0) {
      block += `\n#### Other tests in this group (${membersHistorical.length}) — failed previously but not in this report\n`;
      for (const m of membersHistorical) {
        const fileSuffix = m.filePath ? ` (${m.filePath})` : '';
        block += `- ${m.title} [testId: ${m.testId}]${fileSuffix} (${m.occurrences} occurrences)\n`;
      }
    }
    block += '\n';
  }
  return block;
}

function buildIsolatedFailuresBlock(unclustered: ReportSummaryUnclusteredFailure[]): string {
  if (unclustered.length === 0) return '';
  let block = `## Isolated Failures (${unclustered.length})\n`;
  block += `Failures in this report that don't share a fix target with any other test. Each carries its per-test analysis.\n\n`;
  for (const f of unclustered) {
    const fileSuffix = f.filePath ? ` (${f.filePath})` : '';
    const trendLabel = renderTrendLabel(f.trend);
    block += `### ${f.title} [testId: ${f.testId}] [${f.category}]${fileSuffix}${trendLabel}\n`;
    if (f.errorSignature) {
      block += `- Signature: \`${f.errorSignature}\`\n`;
    }
    if (f.message) {
      block += `- Error:\n\`\`\`\n${truncateMiddle(f.message, MEMBER_MESSAGE_MAX_CHARS)}\n\`\`\`\n`;
    }
    if (f.analysis) {
      const rootCause = extractRootCauseParagraph(f.analysis);
      const indented = rootCause.replace(/\n/g, '\n  ');
      block += `- Per-test analysis:\n  ${indented}\n`;
    }
    block += '\n';
  }
  return block;
}

function buildFlakyTestsBlock(flaky: ReportSummaryFlakyTest[] | undefined): string {
  if (!flaky || flaky.length === 0) return '';
  let block = `## Flaky Tests (${flaky.length}) — passed on retry; not failures\n\n`;
  for (const f of flaky) {
    const fileSuffix = f.filePath ? ` (${f.filePath})` : '';
    block += `### ${f.title} [testId: ${f.testId}] [${f.category}]${fileSuffix}\n`;
    if (f.errorSignature) {
      block += `- Signature: \`${f.errorSignature}\`\n`;
    }
    if (f.message) {
      block += `- Error (from the failing attempt):\n\`\`\`\n${truncateMiddle(f.message, MEMBER_MESSAGE_MAX_CHARS)}\n\`\`\`\n`;
    }
    if (f.analysis) {
      const rootCause = extractRootCauseParagraph(f.analysis);
      const indented = rootCause.replace(/\n/g, '\n  ');
      block += `- Per-test analysis:\n  ${indented}\n`;
    }
    block += '\n';
  }
  return block;
}

function buildReportTrendBlock(
  ctx: ReportSummaryTrendContext,
  perTestAnalyses: Array<{ testTitle: string; category: string; analysis: string }> = []
): string {
  const { previousReport, counts } = ctx;
  const prevLabel = previousReport.displayNumber
    ? `#${previousReport.displayNumber}`
    : previousReport.title || previousReport.reportId.slice(0, 8);

  const lines: string[] = [];
  lines.push(`## Trend vs previous report (${prevLabel} from ${previousReport.createdAt})`);
  lines.push('');
  lines.push('Use this to call out what changed in your "Failure Patterns" and "Risks" sections.');
  lines.push('');
  lines.push(`- Newly failed: **${counts.newlyFailed}**`);
  lines.push(`- Fixed since previous: **${counts.fixed}**`);
  lines.push(`- Still failing: **${counts.stillFailing}**`);
  lines.push(`- New tests added: **${counts.newTests}**`);
  lines.push(`- Tests removed: **${counts.removedTests}**`);
  lines.push(
    `- Duration regressions: **${counts.durationRegressions}** · improvements: **${counts.durationImprovements}**`
  );
  lines.push('');

  const insights = computeTrendInsights(ctx.newlyFailed, perTestAnalyses);
  if (insights.length > 0) {
    lines.push(`### Insights`);
    lines.push(...insights);
    lines.push('');
  }

  if (ctx.topDurationRegressions.length > 0) {
    lines.push('### Top duration regressions');
    for (const d of ctx.topDurationRegressions.slice(0, 10)) {
      const sign = d.deltaMs > 0 ? '+' : '';
      lines.push(
        `- ${d.title} (${d.filePath}): ${formatMs(d.durationA)} -> ${formatMs(d.durationB)} (${sign}${(d.deltaPct * 100).toFixed(0)}%)`
      );
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function collectPerTestAnalyses(
  clusters: ReportSummaryCluster[],
  unclustered: ReportSummaryUnclusteredFailure[]
): Array<{ testTitle: string; category: string; analysis: string }> {
  const result: Array<{ testTitle: string; category: string; analysis: string }> = [];
  for (const c of clusters) {
    for (const m of c.members) {
      if (!m.inThisReport) continue;
      result.push({
        testTitle: m.title,
        category: m.category ?? c.category ?? 'unknown',
        analysis: m.analysis,
      });
    }
  }
  for (const f of unclustered) {
    result.push({
      testTitle: f.title,
      category: f.category,
      analysis: f.analysis,
    });
  }
  return result;
}

export const buildReportSummarySegments = (args: {
  systemPrompt?: string;
  reportId: string;
  categories: Record<string, number>;
  clusters: ReportSummaryCluster[];
  unclustered: ReportSummaryUnclusteredFailure[];
  flaky?: ReportSummaryFlakyTest[];
  runContext?: RunContext;
  trendContext?: ReportSummaryTrendContext;
  overrides?: CustomPromptOverrides;
}): SegmentedPrompt => {
  const totalFailures = Object.values(args.categories).reduce((sum, c) => sum + c, 0);

  const reportInstructionsTemplate =
    args.overrides?.reportSummaryPrompt ?? REPORT_SUMMARY_TASK_INSTRUCTIONS;
  const reportBindings = {
    reportId: args.reportId,
    project: args.overrides?.project,
    totalFailures,
  };
  const { request: requestTemplate, contract: contractTemplate } = splitTaskInstructions(
    reportInstructionsTemplate
  );
  const requestSub = applyMustache(requestTemplate, reportBindings, REPORT_SUMMARY_VARS);
  const contractSub = applyMustache(contractTemplate, reportBindings, REPORT_SUMMARY_VARS);

  const dataBlock = [
    buildReportHeaderBlock(args.reportId, totalFailures),
    buildFailureGroupsBlock(args.clusters),
    buildIsolatedFailuresBlock(args.unclustered),
    buildFlakyTestsBlock(args.flaky),
  ]
    .filter(Boolean)
    .join('\n\n')
    .trimEnd();

  const trendBlock = args.trendContext
    ? buildReportTrendBlock(
        args.trendContext,
        collectPerTestAnalyses(args.clusters, args.unclustered)
      )
    : undefined;

  return assembleSegments([
    buildSegment(
      'system_prompt',
      'system',
      true,
      resolveSystemPrompt(
        REPORT_SUMMARY_SYSTEM_PROMPT,
        args.overrides?.systemPrompt ?? args.systemPrompt
      )
    ),
    buildGeneralContextSegment(args.overrides?.generalContext),
    buildSegment('task_contract', 'user', !contractSub.substituted, contractSub.rendered),
    buildSegment('task_request', 'user', !requestSub.substituted, requestSub.rendered),
    buildSegment('run_data_open', 'user', false, '<run_data>'),
    buildSegment('run_context', 'user', false, buildRunContextBlock(args.runContext)),
    buildSegment('report_data', 'user', false, dataBlock),
    buildSegment('trend_context', 'user', false, trendBlock),
    buildSegment('run_data_close', 'user', false, '</run_data>'),
  ]);
};

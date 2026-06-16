import type {
  ClusterAnchor,
  ClusterAnchorKind,
  RegressionsAggregate,
} from '@playwright-reports/shared';
import { formatDuration } from '@playwright-reports/shared';
import type { SegmentedPrompt } from '../../types/index.js';
import {
  applyMustache,
  assembleSegments,
  buildGeneralContextSegment,
  buildSegment,
  resolveSystemPrompt,
  splitTaskInstructions,
} from '../assembleSegments.js';
import { describeGroupKind, renderAnchorInline } from '../clusterRendering.js';
import type { CustomPromptOverrides, RunContext } from '../promptTypes.js';
import {
  PROJECT_SUMMARY_SYSTEM_PROMPT,
  PROJECT_SUMMARY_TASK_INSTRUCTIONS,
  PROJECT_SUMMARY_VARS,
} from './instructions.js';

export interface ProjectCluster {
  stableKey: string;
  kind: ClusterAnchorKind;
  anchor: ClusterAnchor;
  category: string;
  occurrences: number;
  reportsAffected: number;
  affectedTests: Array<{
    testId: string;
    fileId: string;
    title: string;
    filePath: string;
    project: string;
  }>;
  sampleMessage: string;
  latestRootCause?: string;
  firstSeenReportId: string;
  firstSeenAt: string;
  firstSeenDisplayNumber?: number;
  lastSeenReportId: string;
  lastSeenAt: string;
  lastSeenDisplayNumber?: number;
  appearedInLatestRun: boolean;
  consecutiveLatestRuns: number;
  runsSinceLastSeen: number;
  flakyOccurrences: number;
  retryRecoveryRate: number;
}

export interface ProjectTrendWindow {
  runs: number;
  passingRuns: number;
  passRatePct: number;
  flakyCount: number;
  failureCount: number;
  avgRunDurationMs: number;
}

export interface ClusterFlow {
  resolvedCount: number;
  persistingCount: number;
  newCount: number;
  topResolved: Array<{
    kind: ClusterAnchorKind;
    category: string;
    reportsAffected: number;
    sampleTest?: string;
  }>;
}

export interface ProjectNearFlake {
  testId: string;
  fileId: string;
  title: string;
  filePath: string;
  flakyOccurrences: number;
}

export interface ProjectCoverageScope {
  totalTests: number;
  testsAddedInWindow: number;
  currentlyQuarantined: number;
  quarantineFailuresInWindow: number;
  windowDistinctTests: number;
  priorDistinctTests?: number;
  nearFlakes: ProjectNearFlake[];
}

export interface ProjectTrendSignal {
  current: ProjectTrendWindow;
  prior?: ProjectTrendWindow;
  splits?: {
    halfSize: number;
    lastHalfFailures: number;
    firstHalfFailures: number;
  };
  clusterFlow?: ClusterFlow;
}

function formatSignedPct(delta: number): string {
  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0) return '0.0%';
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}%`;
}

function formatSignedCount(delta: number): string {
  if (delta === 0) return '0';
  return `${delta > 0 ? '+' : ''}${delta}`;
}

function formatSignedDuration(deltaMs: number): string {
  if (deltaMs === 0) return '±0';
  const sign = deltaMs > 0 ? '+' : '-';
  return `${sign}${formatDuration(Math.abs(deltaMs))}`;
}

function formatRunLabel(reportId: string, displayNumber?: number): string {
  return typeof displayNumber === 'number'
    ? `#${displayNumber} [reportId: ${reportId}]`
    : `[reportId: ${reportId}]`;
}

function formatRunRef(reportId: string, displayNumber?: number): string {
  return typeof displayNumber === 'number'
    ? `#${displayNumber} [reportId: ${reportId}]`
    : `[reportId: ${reportId}]`;
}

function isoDate(iso: string): string {
  return iso.slice(0, 10);
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  return Math.max(1, Math.round((to - from) / 86_400_000));
}

function renderRunContextInline(ctx: RunContext): string | null {
  const parts: string[] = [];
  if (ctx.gitCommit) {
    const g = ctx.gitCommit;
    if (g.branch) parts.push(`branch=\`${g.branch}\``);
    const hash = g.shortHash ?? g.hash;
    if (hash) {
      const subject = g.subject ? ` "${g.subject.replace(/"/g, "'")}"` : '';
      parts.push(`commit=\`${hash}\`${subject}`);
    } else if (g.subject) {
      parts.push(`subject="${g.subject.replace(/"/g, "'")}"`);
    }
  }
  if (ctx.ci) {
    if (ctx.ci.buildHref) parts.push(`ci=${ctx.ci.buildHref}`);
    else if (ctx.ci.commitHref) parts.push(`ci_commit=${ctx.ci.commitHref}`);
    else if (ctx.ci.commitHash) parts.push(`ci_commit=\`${ctx.ci.commitHash}\``);
  }
  if (ctx.playwrightVersion) parts.push(`pw=${ctx.playwrightVersion}`);
  if (typeof ctx.actualWorkers === 'number') parts.push(`workers=${ctx.actualWorkers}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function renderRegressionsAggregate(reg: RegressionsAggregate): string {
  const lines: string[] = ['## Regression Activity'];
  lines.push(
    `- **Active regressions:** ${reg.active} (tests that failed and have not yet recovered)`
  );
  lines.push(`- **New in window:** ${reg.newInWindow}`);
  lines.push(`- **Resolved in window:** ${reg.resolvedInWindow}`);
  if (reg.medianMttrDays !== null) {
    const mttr =
      reg.medianMttrDays < 1
        ? `${Math.round(reg.medianMttrDays * 24)}h`
        : `${Math.round(reg.medianMttrDays * 10) / 10}d`;
    lines.push(`- **Median MTTR (resolved):** ${mttr}`);
  }
  if (reg.topCommits.length > 0) {
    const list = reg.topCommits
      .slice(0, 3)
      .map((c) => `\`${c.commit}\` (${c.count})`)
      .join('; ');
    lines.push(`- **Top regressing commits:** ${list}`);
  }
  if (reg.topFiles.length > 0) {
    const list = reg.topFiles
      .slice(0, 3)
      .map((f) => `\`${f.filePath}\` (${f.count})`)
      .join('; ');
    lines.push(`- **Top regressing files:** ${list}`);
  }
  lines.push(
    '- Interpretation: a non-zero "Active regressions" count means failures are still unresolved; weight these higher than chronic-flake clusters when picking the verdict.'
  );
  return `${lines.join('\n')}\n\n`;
}

function renderTrendSignal(signal: ProjectTrendSignal): string {
  let block = `## Trend Signal\n`;
  const { current, prior, splits, clusterFlow } = signal;
  const currentLine = (label: string, value: string, delta?: string): string =>
    delta
      ? `- **${label}:** ${value} (Δ ${delta} vs prior ${prior?.runs ?? 0} runs)\n`
      : `- **${label}:** ${value}\n`;

  block += currentLine(
    'Pass rate',
    `${current.passRatePct.toFixed(1)}%`,
    prior ? formatSignedPct(current.passRatePct - prior.passRatePct) : undefined
  );
  block += currentLine(
    'Total failures',
    `${current.failureCount} (${current.flakyCount} flaky)`,
    prior ? formatSignedCount(current.failureCount - prior.failureCount) : undefined
  );
  block += currentLine(
    'Avg run duration',
    formatDuration(current.avgRunDurationMs),
    prior ? formatSignedDuration(current.avgRunDurationMs - prior.avgRunDurationMs) : undefined
  );
  if (splits) {
    block += `- **Last ${splits.halfSize} vs prior ${splits.halfSize} (in-window):** ${splits.lastHalfFailures} vs ${splits.firstHalfFailures} failures\n`;
  }

  if (prior) {
    block += `- **Prior ${prior.runs} runs:** ${prior.passingRuns} of ${prior.runs} passed cleanly · pass rate ${prior.passRatePct.toFixed(1)}% · ${prior.failureCount} failures\n`;
  }

  if (clusterFlow) {
    block += `- **Cluster flow vs prior window:** ${clusterFlow.resolvedCount} resolved · ${clusterFlow.persistingCount} persisting · ${clusterFlow.newCount} new\n`;
    if (clusterFlow.topResolved.length > 0) {
      const resolvedList = clusterFlow.topResolved
        .map((r) =>
          r.sampleTest
            ? `\`${r.kind}\`/\`${r.category}\` (was in ${r.reportsAffected} prior runs, e.g. \`${r.sampleTest}\`)`
            : `\`${r.kind}\`/\`${r.category}\` (was in ${r.reportsAffected} prior runs)`
        )
        .join('; ');
      block += `- **Top resolved:** ${resolvedList}\n`;
    }
  }

  block += '\n';
  return block;
}

interface ProjectRun {
  reportId: string;
  displayNumber?: number;
  createdAt: string;
  stats: { total: number; expected: number; unexpected: number; flaky: number; skipped: number };
  totalFailures: number;
  categories: Record<string, number>;
  llmSummary?: string;
  runContext?: RunContext;
}

function runHasFailures(r: ProjectRun): boolean {
  return r.totalFailures > 0 || (r.stats?.unexpected ?? 0) > 0 || (r.stats?.flaky ?? 0) > 0;
}

function buildProjectOverviewBlock(
  project: string,
  runs: ProjectRun[],
  coverage: ProjectCoverageScope | undefined
): string {
  const totalRuns = runs.length;
  const runsWithFailures = runs.filter(runHasFailures);
  const passingRuns = totalRuns - runsWithFailures.length;
  const latestRun = runs[0];
  const latestStatus = latestRun ? (runHasFailures(latestRun) ? 'FAILURES' : 'PASS') : 'unknown';

  let block = `Project: "${project}", latest ${totalRuns} runs.\n\n`;

  const oldestRun = runs[totalRuns - 1];
  if (latestRun && oldestRun) {
    const days = daysBetweenIso(oldestRun.createdAt, latestRun.createdAt);
    const oldestDay = oldestRun.createdAt.slice(0, 10);
    const latestDay = latestRun.createdAt.slice(0, 10);
    block += `**Window:** ${oldestDay} -> ${latestDay} (${days} day${days === 1 ? '' : 's'}, ${totalRuns} run${totalRuns === 1 ? '' : 's'})\n`;
  }
  block += `**Statistics:** ${passingRuns} of ${totalRuns} runs passed cleanly (no failures). ${runsWithFailures.length} runs had failures.\n`;

  if (coverage) {
    const c = coverage;
    const addedPart = c.testsAddedInWindow > 0 ? ` · ${c.testsAddedInWindow} added in window` : '';
    const quarantinePart =
      c.currentlyQuarantined > 0
        ? ` · ${c.currentlyQuarantined} quarantined${c.quarantineFailuresInWindow > 0 ? ` (${c.quarantineFailuresInWindow} quarantined runs still failing in window)` : ''}`
        : '';
    block += `**Suite:** ${c.totalTests} tests${addedPart}${quarantinePart}\n`;
    if (typeof c.priorDistinctTests === 'number') {
      const delta = c.windowDistinctTests - c.priorDistinctTests;
      const deltaLabel = delta === 0 ? '0' : delta > 0 ? `+${delta}` : String(delta);
      block += `**Suite coverage:** ${c.windowDistinctTests} distinct tests ran this window (Δ ${deltaLabel} vs prior window's ${c.priorDistinctTests})\n`;
    }
    if (c.nearFlakes.length > 0) {
      const list = c.nearFlakes
        .map(
          (nf) =>
            `\`${nf.title}\` (${nf.filePath}) [testId: ${nf.testId}] — ${nf.flakyOccurrences}×`
        )
        .join('; ');
      block += `**Near-flakes (passed on retry):** ${list}\n`;
    }
  }
  block += `**Latest run status:** ${latestStatus}${latestRun ? ` (${formatRunLabel(latestRun.reportId, latestRun.displayNumber)})` : ''} — use this to anchor the verdict.\n`;

  return block;
}

function buildCrossProjectPreambleBlock(
  project: string,
  clusters: ProjectCluster[] | undefined
): string {
  if (project !== 'all' || !clusters || clusters.length === 0) return '';
  const distinctProjects = new Set<string>();
  for (const c of clusters) {
    for (const t of c.affectedTests) distinctProjects.add(t.project);
  }
  if (distinctProjects.size <= 1) return '';
  const list = Array.from(distinctProjects)
    .sort()
    .map((p) => `\`${p}\``)
    .join(', ');
  return `**Cross-project aggregate:** this window spans ${distinctProjects.size} distinct projects (${list}). Each project represents a separate area or test suite — a failure cluster in one project does NOT imply the same regression in another. When summarizing health, prefer per-project framing ("X is degrading, Y is healthy") over a single blended verdict; tie recommendations to the specific project of each cited test.\n`;
}

function buildActiveClustersBlock(clusters: ProjectCluster[]): string {
  if (clusters.length === 0) return '';
  let block = `## Active Failure Patterns (present in latest run or within last 2 runs — drive Recommendations)\n`;
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    const anchorLine = renderAnchorInline(c.anchor);
    const kindLabel = describeGroupKind(c.kind);
    block += `\n### ${i + 1}. ${kindLabel} — \`${c.category}\` — ${c.occurrences}× across ${c.reportsAffected} run${c.reportsAffected === 1 ? '' : 's'} (${c.affectedTests.length} test${c.affectedTests.length === 1 ? '' : 's'})\n`;
    if (anchorLine) {
      block += `- **Fix target:** ${anchorLine}\n`;
    }
    const sample = c.sampleMessage.replace(/\s+/g, ' ').trim();
    const sampleTrunc = sample.length > 300 ? `${sample.substring(0, 300)}…` : sample;
    if (sampleTrunc) {
      block += `- **Sample error:** \`${sampleTrunc}\`\n`;
    }
    const testsList = c.affectedTests
      .slice(0, 3)
      .map((t) => `\`${t.title}\` (${t.filePath}; project=${t.project}) [testId: ${t.testId}]`)
      .join(', ');
    const more = c.affectedTests.length > 3 ? ` +${c.affectedTests.length - 3} more` : '';
    block += `- **Affected tests:** ${testsList}${more}\n`;
    const latestMarker = c.appearedInLatestRun
      ? `**in latest run** (${c.consecutiveLatestRuns} consecutive)`
      : `last seen ${c.runsSinceLastSeen} run${c.runsSinceLastSeen === 1 ? '' : 's'} ago`;
    const firstSeenRef = formatRunRef(c.firstSeenReportId, c.firstSeenDisplayNumber);
    const lastSeenRef = formatRunRef(c.lastSeenReportId, c.lastSeenDisplayNumber);
    block += `- **Window:** first seen ${firstSeenRef} (${isoDate(c.firstSeenAt)}) -> last seen ${lastSeenRef} (${isoDate(c.lastSeenAt)}); ${latestMarker}\n`;
    if (c.occurrences > 0) {
      const pct = Math.round(c.retryRecoveryRate * 100);
      block += `- **Retry recovery:** ${pct}% (${c.flakyOccurrences} of ${c.occurrences} occurrences ultimately passed on retry)\n`;
    }
    if (c.latestRootCause) {
      const indented = c.latestRootCause.replace(/\n/g, '\n  ');
      block += `- **Prior LLM root cause:**\n  ${indented}\n`;
    }
  }
  block += '\n';
  return block;
}

function buildResolvedClustersBlock(clusters: ProjectCluster[]): string {
  if (clusters.length === 0) return '';
  let block = `## Recently Resolved Patterns (NOT for Recommendations — cite only as recovery evidence in Health Assessment)\n`;
  for (const c of clusters) {
    const lastSeenRef = formatRunRef(c.lastSeenReportId, c.lastSeenDisplayNumber);
    const titles = c.affectedTests
      .slice(0, 2)
      .map((t) => `\`${t.title}\``)
      .join(', ');
    const more = c.affectedTests.length > 2 ? ` +${c.affectedTests.length - 2} more` : '';
    const kindLabel = describeGroupKind(c.kind);
    block += `- ${kindLabel} (\`${c.category}\`) — ${c.occurrences}× across ${c.reportsAffected} run${c.reportsAffected === 1 ? '' : 's'}; last seen ${lastSeenRef} (${c.runsSinceLastSeen} runs ago); tests: ${titles}${more}\n`;
  }
  block += '\n';
  return block;
}

function buildRunListBlock(runs: ProjectRun[]): string {
  let block = `Runs are listed from most recent to oldest:\n\n`;
  for (const run of runs) {
    const status = runHasFailures(run) ? 'FAILURES' : 'PASS';
    const runLabel = formatRunLabel(run.reportId, run.displayNumber);
    block += `### Run ${runLabel} (${run.createdAt}) — ${status}\n`;
    block += `- Tests: ${run.stats.total} total, ${run.stats.expected} passed, ${run.stats.unexpected} failed, ${run.stats.flaky} flaky, ${run.stats.skipped} skipped\n`;
    if (run.runContext) {
      const ctxLine = renderRunContextInline(run.runContext);
      if (ctxLine) block += `- Context: ${ctxLine}\n`;
    }
    if (runHasFailures(run)) {
      const categoryEntries = Object.entries(run.categories);
      if (categoryEntries.length > 0) {
        for (const [cat, count] of categoryEntries.sort((a, b) =>
          b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])
        )) {
          block += `  - ${cat}: ${count}\n`;
        }
      }
      if (run.llmSummary) {
        block += `- Summary: ${run.llmSummary.substring(0, 300)}\n`;
      }
    }
    block += '\n';
  }
  return block;
}

export const buildProjectSummarySegments = (args: {
  systemPrompt?: string;
  project: string;
  runs: Array<ProjectRun>;
  clusters?: ProjectCluster[];
  trendSignal?: ProjectTrendSignal;
  coverage?: ProjectCoverageScope;
  regressions?: RegressionsAggregate;
  overrides?: CustomPromptOverrides;
}): SegmentedPrompt => {
  const totalRuns = args.runs.length;
  const passingRuns = totalRuns - args.runs.filter(runHasFailures).length;

  const projectInstructionsTemplate =
    args.overrides?.projectSummaryInstructions ?? PROJECT_SUMMARY_TASK_INSTRUCTIONS;
  const projectBindings = {
    project: args.project,
    totalRuns,
    passingRuns,
  };
  const { request: requestTemplate, contract: contractTemplate } = splitTaskInstructions(
    projectInstructionsTemplate
  );
  const requestSub = applyMustache(requestTemplate, projectBindings, PROJECT_SUMMARY_VARS);
  const contractSub = applyMustache(contractTemplate, projectBindings, PROJECT_SUMMARY_VARS);

  const isActiveCluster = (c: ProjectCluster): boolean =>
    c.appearedInLatestRun || c.runsSinceLastSeen <= 2;
  const activeClusters = (args.clusters ?? []).filter(isActiveCluster);
  const resolvedClusters = (args.clusters ?? []).filter((c) => !isActiveCluster(c));

  const dataBlock = [
    buildCrossProjectPreambleBlock(args.project, args.clusters),
    buildProjectOverviewBlock(args.project, args.runs, args.coverage),
    buildActiveClustersBlock(activeClusters),
    buildResolvedClustersBlock(resolvedClusters),
    args.trendSignal ? renderTrendSignal(args.trendSignal) : '',
    args.regressions ? renderRegressionsAggregate(args.regressions) : '',
    buildRunListBlock(args.runs),
  ]
    .filter(Boolean)
    .join('\n')
    .trimEnd();

  return assembleSegments([
    buildSegment(
      'system_prompt',
      'system',
      true,
      resolveSystemPrompt(
        PROJECT_SUMMARY_SYSTEM_PROMPT,
        args.overrides?.systemPrompt ?? args.systemPrompt,
        args.overrides?.projectSummarySystemPrompt
      )
    ),
    buildGeneralContextSegment(args.overrides?.generalContext),
    buildSegment('task_contract', 'user', !contractSub.substituted, contractSub.rendered),
    buildSegment('task_request', 'user', !requestSub.substituted, requestSub.rendered),
    buildSegment('project_data_open', 'user', false, '<project_data>'),
    buildSegment('project_data', 'user', false, dataBlock),
    buildSegment('project_data_close', 'user', false, '</project_data>'),
  ]);
};

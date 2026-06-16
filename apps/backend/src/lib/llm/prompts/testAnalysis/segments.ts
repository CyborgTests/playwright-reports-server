import type { TestDetailRegression } from '@playwright-reports/shared';
import type { FailureEvidence } from '../../../parser/failure-extraction.js';
import type { PerFileStep } from '../../../parser/report-payload.js';
import type { SegmentedPrompt } from '../../types/index.js';
import {
  applyMustache,
  assembleSegments,
  buildGeneralContextSegment,
  buildSegment,
  resolveSystemPrompt,
  splitTaskInstructions,
} from '../assembleSegments.js';
import type { CustomPromptOverrides } from '../promptTypes.js';
import { extractRootCauseParagraph } from '../textTransforms.js';
import {
  TEST_ANALYSIS_SYSTEM_PROMPT,
  TEST_ANALYSIS_TASK_INSTRUCTIONS,
  TEST_ANALYSIS_VARS,
} from './instructions.js';

export interface AttemptSummary {
  attempt: number;
  status: string;
  message?: string;
  durationMs?: number;
}

export interface FailureDetailsForPrompt {
  message: string;
  stackTrace?: string;
  testTitle: string;
  filePath: string;
  location?: { file: string; line: number; column: number };
  attachments?: Array<{ name: string; path: string; contentType: string }>;
  attempt: number;
  status: string;
  attempts?: AttemptSummary[];
  evidence?: FailureEvidence;
}

export interface HistoricalContextInput {
  totalRuns?: number;
  recentFailureCount?: number;
  flakinessScore?: number;
  flakinessThreshold?: number;
  isFlaky?: boolean;
  previousCategories?: string[];
  isNewFailure?: boolean;
  recentOutcomes?: string[];
}

export interface PriorInProjectAnalysis {
  analysis: string;
  category?: string;
  model?: string;
  updatedAt?: string;
}

interface CrossProjectEntry {
  project: string;
  comment: string;
  updatedAt: string;
  errorSignatureMatchesCurrent: boolean;
  latestAnalysis?: { content: string; updatedAt: string; model?: string };
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  const days = Math.floor(ms / 86_400_000);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const OUTCOME_LABELS: Record<string, string> = {
  passed: 'P',
  expected: 'P',
  failed: 'F',
  unexpected: 'F',
  timedout: 'T',
  timedOut: 'T',
  flaky: 'f',
  skipped: '.',
  interrupted: 'I',
};

function outcomeLabel(outcome: string): string {
  return OUTCOME_LABELS[outcome] ?? '?';
}

function buildRunContextBlock(evidence: FailureEvidence | undefined): string {
  const git = evidence?.gitCommit;
  const ci = evidence?.ciBuild;
  if (!git && !ci) return '';
  const lines: string[] = [];
  if (git?.branch) lines.push(`- branch: \`${git.branch}\``);
  if (git?.shortHash || git?.hash) {
    const sub = git.subject ? ` — ${git.subject.replace(/\s+/g, ' ').trim().slice(0, 200)}` : '';
    lines.push(`- commit: \`${git.shortHash ?? git.hash}\`${sub}`);
  } else if (git?.subject) {
    lines.push(`- subject: ${git.subject.replace(/\s+/g, ' ').trim().slice(0, 200)}`);
  }
  if (ci?.buildHref) lines.push(`- ci_build: ${ci.buildHref}`);
  if (ci?.commitHref) lines.push(`- ci_commit: ${ci.commitHref}`);
  if (lines.length === 0) return '';
  return `## Run\n${lines.join('\n')}`;
}

function buildTestMetadataBlock(evidence: FailureEvidence | undefined): string {
  const meta = evidence?.testMeta;
  if (!meta) return '';
  const lines: string[] = [];
  if (meta.titlePath && meta.titlePath.length > 0) {
    lines.push(`- suite: ${meta.titlePath.map((p) => `\`${p}\``).join(' > ')}`);
  }
  if (meta.tags && meta.tags.length > 0) {
    lines.push(`- tags: ${meta.tags.map((t) => `\`${t}\``).join(' ')}`);
  }
  if (meta.annotations && meta.annotations.length > 0) {
    for (const a of meta.annotations) {
      const type = a.type ?? 'annotation';
      const desc = a.description ? `: ${a.description.replace(/\s+/g, ' ').trim()}` : '';
      lines.push(`- ${type}${desc}`);
    }
  }
  if (lines.length === 0) return '';
  return `## Test Metadata\n${lines.join('\n')}`;
}

function buildTestSourceFrameBlock(evidence: FailureEvidence | undefined): string {
  if (!evidence?.testSourceFrame) return '';
  return `## Test Source\n\`\`\`\n${evidence.testSourceFrame}\n\`\`\``;
}

const PRIOR_ANALYSIS_EXCERPT_MAX_CHARS = 240;

function extractRootCauseExcerpt(analysisMarkdown: string): string {
  const trimmed = analysisMarkdown.trim();
  const rootCauseStart = trimmed.search(/^##\s+Root Cause\s*$/im);
  const body = rootCauseStart >= 0 ? trimmed.slice(rootCauseStart) : trimmed;
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('```'));
  const para = lines.length > 0 ? lines[0] : '';
  if (para.length <= PRIOR_ANALYSIS_EXCERPT_MAX_CHARS) return para;
  return `${para.slice(0, PRIOR_ANALYSIS_EXCERPT_MAX_CHARS - 1).trimEnd()}…`;
}

function buildHistoricalContextBlock(historicalContext?: HistoricalContextInput): string {
  if (!historicalContext) return '';
  let block = `## History\n`;
  if (historicalContext.totalRuns) {
    block += `- runs: ${historicalContext.totalRuns}\n`;
  }
  if (historicalContext.recentFailureCount) {
    block += `- recent_failures: ${historicalContext.recentFailureCount}\n`;
  }
  if (historicalContext.isNewFailure === true) {
    block += `- signature: new (not seen in prior runs)\n`;
  } else if (historicalContext.isNewFailure === false) {
    block += `- signature: recurring\n`;
  }
  if (historicalContext.previousCategories && historicalContext.previousCategories.length > 0) {
    block += `- recent_categories (newest first): ${historicalContext.previousCategories.join(' -> ')}\n`;
  }
  return block;
}

function buildFlakinessRationaleBlock(input?: HistoricalContextInput): string {
  if (!input) return '';
  const score = input.flakinessScore;
  const threshold = input.flakinessThreshold;
  const outcomes = input.recentOutcomes;
  const isFlaky = input.isFlaky;
  if (
    score === undefined &&
    threshold === undefined &&
    (!outcomes || outcomes.length === 0) &&
    isFlaky === undefined
  ) {
    return '';
  }

  let block = `## Flakiness\n`;
  if (typeof score === 'number') {
    block += `- score: ${score.toFixed(1)}%`;
    if (typeof threshold === 'number') {
      const cmp = score >= threshold ? '>=' : '<';
      block += ` (threshold ${cmp} ${threshold}%)`;
    }
    block += '\n';
  } else if (typeof threshold === 'number') {
    block += `- threshold: ${threshold}%\n`;
  }
  if (isFlaky === true) {
    block += `- verdict: flaky (recent runs swing pass/fail)\n`;
  } else if (isFlaky === false) {
    block += `- verdict: not flaky (failure is dominant)\n`;
  }
  if (outcomes && outcomes.length > 0) {
    const labels = outcomes.map(outcomeLabel).join('');
    block += `- recent (newest first, P=pass F=fail f=flaky T=timeout .=skip): \`${labels}\`\n`;
  }
  return block;
}

const NETWORK_HEADER_RENDER_KEYS = [
  'content-type',
  'content-length',
  'x-request-id',
  'x-correlation-id',
  'cache-control',
];

function pickRenderHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (NETWORK_HEADER_RENDER_KEYS.includes(lower) || v === '[redacted]') {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The errored step gets a `[FAIL]` marker plus its `snippet` inline so the
 * model sees the failing line without scrolling to the Test Source segment.
 */
function renderStepTree(steps: PerFileStep[]): string {
  const out: string[] = [];

  const containsError = (s: PerFileStep): boolean => {
    if (s.error?.message) return true;
    return (s.steps ?? []).some(containsError);
  };

  const formatStepLocation = (loc?: { file?: string; line?: number; column?: number }): string => {
    if (!loc?.file) return '';
    const line = typeof loc.line === 'number' ? `:${loc.line}` : '';
    return ` (${loc.file}${line})`;
  };

  const formatStepDuration = (ms?: number): string => {
    if (typeof ms !== 'number' || ms <= 0) return '';
    if (ms < 1000) return ` [${ms}ms]`;
    return ` [${(ms / 1000).toFixed(1)}s]`;
  };

  const walk = (step: PerFileStep, depth: number): void => {
    const indent = '  '.repeat(depth);
    const title = (step.title ?? '').replace(/\s+/g, ' ').trim() || '(untitled step)';
    const marker = containsError(step) ? ' [FAIL]' : '';
    const dur = formatStepDuration(step.duration);
    const loc = formatStepLocation(step.location);
    out.push(`${indent}- ${title}${dur}${loc}${marker}`);
    if (step.error?.message) {
      const errLine = step.error.message.replace(/\s+/g, ' ').trim().slice(0, 240);
      out.push(`${indent}  error: ${errLine}`);
    }
    if (step.snippet) {
      out.push(`${indent}  \`\`\``);
      for (const line of step.snippet.split('\n')) {
        out.push(`${indent}  ${line}`);
      }
      out.push(`${indent}  \`\`\``);
    }
    if (step.steps && step.steps.length > 0) {
      for (const child of step.steps) walk(child, depth + 1);
    }
  };

  for (const root of steps) walk(root, 0);
  return out.join('\n');
}

function buildRegressionContextBlock(reg: TestDetailRegression | null | undefined): string {
  if (!reg) return '';
  const lines: string[] = ['## Regression'];
  lines.push(`- This test is a tracked regression: pass -> fail transition, not resolved.`);
  const ageLabel =
    reg.daysOpen < 1
      ? `${Math.round(reg.daysOpen * 24)}h`
      : `${Math.round(reg.daysOpen * 10) / 10}d`;
  lines.push(`- Opened ${ageLabel} ago (${reg.regressedAt}).`);
  if (reg.regressedAtCommit && reg.lastGreenCommit) {
    lines.push(
      `- Suspect range: last green commit \`${reg.lastGreenCommit}\` → first red commit \`${reg.regressedAtCommit}\`.`
    );
  } else if (reg.regressedAtCommit) {
    lines.push(
      `- First red commit: \`${reg.regressedAtCommit}\` (no green baseline commit recorded).`
    );
  } else if (reg.lastGreenCommit) {
    lines.push(`- Last green commit: \`${reg.lastGreenCommit}\` (regressing commit not recorded).`);
  }
  lines.push(
    `- Since opening: ${reg.failureCount} failing run${reg.failureCount === 1 ? '' : 's'}, ${reg.flakyCount} flaky pass${reg.flakyCount === 1 ? '' : 'es'}.`
  );
  lines.push(
    '- Frame the root cause around the change in the suspect range, not chronic flake or a first-time defect; if the evidence contradicts that, say so.'
  );
  lines.push(
    "- Treat the commits as a hint: they're from whatever workspace the reporter ran in (test repo, app repo, or a monorepo), so if the failing frame isn't in that diff, name the gap rather than force a conclusion."
  );
  return lines.join('\n');
}

function summarizeAttemptMessage(message: string | undefined, maxChars = 200): string {
  if (!message) return '';
  const oneLine = message.replace(/\s+/g, ' ').trim();
  return oneLine.length > maxChars ? `${oneLine.substring(0, maxChars)}…` : oneLine;
}

// Comparison-stable signature for grouping attempts that failed the same way
function normalizeAttemptSignature(message: string | undefined): string {
  if (!message) return '';
  return message
    .replace(/\d+/g, 'N')
    .replace(/['"`][^'"`]*['"`]/g, 'S')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 500);
}

function buildPriorInProjectAnalysisBlock(
  prior:
    | {
        analysis: string;
        category?: string;
        model?: string;
        updatedAt?: string;
      }
    | undefined
): string {
  if (!prior?.analysis) return '';
  const meta: string[] = [];
  if (prior.category) meta.push(prior.category);
  if (prior.model) meta.push(prior.model);
  if (prior.updatedAt) meta.push(relativeTime(prior.updatedAt));
  const header = meta.length > 0 ? ` (${meta.join(' · ')})` : '';
  const excerpt = extractRootCauseExcerpt(prior.analysis);
  if (!excerpt) return `## Prior Analysis${header}\n_(excerpt unavailable)_`;
  return `## Prior Analysis${header}\n_This is a prior hypothesis, not ground truth. Compare it against the current evidence. If it still holds, confirm briefly and note any new supporting evidence. If the current evidence contradicts it, say so explicitly and explain what changed._\n\n> ${excerpt}`;
}

function buildConsoleLogBlock(evidence: FailureEvidence | undefined): string {
  if (!evidence?.consoleEvents || evidence.consoleEvents.length === 0) return '';
  const errors = evidence.consoleEvents.filter((e) => e.level === 'error' || e.level === 'warning');
  const otherCount = evidence.consoleEvents.length - errors.length;
  if (errors.length === 0) return '';
  // Only errors/warnings are diagnostic; info/debug/log events are omitted (the
  // count is kept so the model knows they existed) to avoid a low-signal dump.
  const suffix = otherCount > 0 ? `, ${otherCount} info/debug omitted` : '';
  let block = `## Console (errors+warnings${suffix})\n`;
  for (const ev of errors) {
    const loc = ev.location?.url
      ? ` @${ev.location.url}${ev.location.lineNumber ? `:${ev.location.lineNumber}` : ''}`
      : '';
    block += `- ${ev.level}: ${ev.text}${loc}\n`;
  }
  return block;
}

function buildNetworkActivityBlock(evidence: FailureEvidence | undefined): string {
  if (!evidence?.networkEvents || evidence.networkEvents.length === 0) return '';
  let block = `## Network (failed + recent successful)\n`;
  for (const ev of evidence.networkEvents) {
    const isFailed = !!ev.failureText || (typeof ev.status === 'number' && ev.status >= 400);
    const marker = isFailed ? '[FAIL]' : '[OK]';
    const status = ev.failureText
      ? `failed (${ev.failureText})`
      : typeof ev.status === 'number'
        ? String(ev.status)
        : '-';
    block += `- ${marker} \`${ev.method} ${ev.url}\` -> ${status}\n`;
    if (isFailed) {
      const reqHeaders = pickRenderHeaders(ev.requestHeaders);
      const respHeaders = pickRenderHeaders(ev.responseHeaders);
      if (reqHeaders) {
        const headerList = Object.entries(reqHeaders)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ');
        block += `  - req headers: ${headerList}\n`;
      }
      if (ev.requestBody) {
        block += `  - req body: \`${ev.requestBody.replace(/\n/g, ' ').slice(0, 400)}\`\n`;
      }
      if (respHeaders) {
        const headerList = Object.entries(respHeaders)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ');
        block += `  - resp headers: ${headerList}\n`;
      }
      if (ev.responseBody) {
        block += `  - resp body: \`${ev.responseBody.replace(/\n/g, ' ').slice(0, 400)}\`\n`;
      }
    }
  }
  const failed = evidence.networkEvents.filter(
    (n) => !!n.failureText || (typeof n.status === 'number' && n.status >= 400)
  );
  if (failed.length === 0) {
    block += `(no failed requests; entries above are pre-failure context)\n`;
  }
  return block;
}

function buildEnvironmentBlock(evidence: FailureEvidence | undefined): string {
  const env = evidence?.environment;
  if (!env) return '';
  const lines: string[] = [];
  if (env.browserName) {
    const channel = env.browserChannel ? ` (${env.browserChannel})` : '';
    lines.push(`- browser: ${env.browserName}${channel}`);
  }
  if (env.viewport) {
    lines.push(`- viewport: ${env.viewport.width}x${env.viewport.height}`);
  }
  if (env.baseURL) lines.push(`- base_url: ${env.baseURL}`);
  if (env.locale) lines.push(`- locale: ${env.locale}`);
  if (env.timezone) lines.push(`- timezone: ${env.timezone}`);
  // user_agent (duplicates browser + channel + version) and sdkLanguage are
  // dropped as low-signal-per-token for a single-failure diagnosis.
  if (env.playwrightVersion) lines.push(`- playwright: ${env.playwrightVersion}`);
  if (lines.length === 0) return '';
  return `## Environment\n${lines.join('\n')}`;
}

function buildRecentActionsBlock(evidence: FailureEvidence | undefined): string {
  if (!evidence?.actionLog || evidence.actionLog.length === 0) return '';
  let block = `## Recent Actions (n=${evidence.actionLog.length})\n`;
  const t0 = evidence.actionLog.find((a) => typeof a.startTime === 'number')?.startTime ?? 0;
  for (const a of evidence.actionLog) {
    const tStart = typeof a.startTime === 'number' ? `[t+${Math.round(a.startTime - t0)}ms] ` : '';
    const dur =
      typeof a.startTime === 'number' && typeof a.endTime === 'number'
        ? ` (${Math.round(a.endTime - a.startTime)}ms)`
        : '';
    const ns = a.namespace && a.action && !a.action.includes(a.namespace) ? `${a.namespace}.` : '';
    const tgt = a.target ? ` \`${a.target.replace(/`/g, "'").slice(0, 200)}\`` : '';
    const err = a.error ? ` -- error: ${a.error.replace(/\s+/g, ' ').slice(0, 200)}` : '';
    block += `- ${tStart}\`${ns}${a.action}\`${tgt}${dur}${err}\n`;
  }
  return block;
}

function buildFailureDetailsBlock(failureDetails: FailureDetailsForPrompt): string {
  let block = '';

  if (failureDetails.attempts && failureDetails.attempts.length > 1) {
    const attempts = failureDetails.attempts;
    const failedAttempts = attempts.filter((a) => a.status !== 'passed');
    const totalFailed = failedAttempts.length;
    const finalAttempt = attempts[attempts.length - 1];
    const finalOutcome = finalAttempt.status === 'passed' ? 'eventually passed' : 'never recovered';

    const sigByAttempt = new Map<number, string>();
    const firstAttemptForSig = new Map<string, number>();
    for (const a of failedAttempts) {
      const sig = normalizeAttemptSignature(a.message);
      sigByAttempt.set(a.attempt, sig);
      if (sig && !firstAttemptForSig.has(sig)) firstAttemptForSig.set(sig, a.attempt);
    }
    const distinctFailureSigs = firstAttemptForSig.size;

    const headerSuffix =
      totalFailed <= 1
        ? ''
        : distinctFailureSigs === 1
          ? '; all failures share the same signature'
          : `; ${distinctFailureSigs} distinct signatures across ${totalFailed} failures`;

    block += `## Attempts (n=${attempts.length}, failed=${totalFailed}, ${finalOutcome}${headerSuffix})\n`;

    const fullMsgCap = distinctFailureSigs > 1 ? 500 : 200;

    for (const a of attempts) {
      const dur = a.durationMs !== undefined ? ` ${a.durationMs}ms` : '';
      let detail = '';
      if (a.status === 'passed') {
        detail = '';
      } else {
        const sig = sigByAttempt.get(a.attempt) ?? '';
        const firstForSig = sig ? firstAttemptForSig.get(sig) : undefined;
        if (firstForSig !== undefined && firstForSig !== a.attempt) {
          detail = ` -- same as #${firstForSig}`;
        } else {
          detail = ` -- ${summarizeAttemptMessage(a.message, fullMsgCap)}`;
        }
      }
      block += `- #${a.attempt} (${a.status}${dur})${detail}\n`;
    }
    block += '\n';
  }

  block += `## Error\n\`\`\`\n${failureDetails.message}\n\`\`\`\n`;

  if (failureDetails.stackTrace) {
    block += `\n## Stack\n\`\`\`\n${failureDetails.stackTrace}\n\`\`\`\n`;
  }

  return block.trimEnd();
}

export const buildFeedbackContext = (
  feedback: { comment: string; updatedAt: string } | null
): string => {
  if (!feedback) return '';
  return `\n## User Feedback (high-priority; weight heavily, surface contradictions with evidence)\n\n> ${feedback.comment.replace(/\n/g, '\n> ')}\n\n(updated ${relativeTime(feedback.updatedAt)})\n`;
};

export const buildPerTestFeedbackContext = (
  notes: Array<{ testTitle?: string; comment: string; updatedAt: string }>
): string => {
  if (notes.length === 0) return '';
  let block = `\n## Per-Test Feedback Notes\n`;
  for (const n of notes) {
    block += `- **${n.testTitle ?? 'test'}** (updated ${relativeTime(n.updatedAt)}): ${n.comment}\n`;
  }
  return block;
};

export const buildCrossProjectContext = (
  entries: CrossProjectEntry[],
  totalCount = entries.length
): string => {
  if (entries.length === 0) return '';
  let block = `\n## Cross-Project (same test, other projects)\n`;
  for (const e of entries) {
    const sig = e.errorSignatureMatchesCurrent ? 'matching error' : 'different error';
    block += `\n### ${e.project} (${sig}, updated ${relativeTime(e.updatedAt)})\n`;
    block += `${e.comment}\n`;
    if (e.latestAnalysis) {
      const modelInfo = e.latestAnalysis.model ? ` · ${e.latestAnalysis.model}` : '';
      block += `prior_analysis (${relativeTime(e.latestAnalysis.updatedAt)}${modelInfo}):\n${e.latestAnalysis.content}\n`;
    }
  }
  if (totalCount > entries.length) {
    block += `\n(+${totalCount - entries.length} more not shown)\n`;
  }
  return block;
};

export { extractRootCauseParagraph };

export const buildTestFailureSegments = (args: {
  systemPrompt?: string;
  failureDetails: FailureDetailsForPrompt;
  historicalContext?: HistoricalContextInput;
  feedback?: { comment: string; updatedAt: string } | null;
  crossProjectEntries?: CrossProjectEntry[];
  crossProjectTotalCount?: number;
  priorInProjectAnalysis?: PriorInProjectAnalysis | null;
  regressionContext?: TestDetailRegression | null;
  overrides?: CustomPromptOverrides;
}): SegmentedPrompt => {
  const evidence = args.failureDetails.evidence;

  const taskInstructionsTemplate =
    args.overrides?.testAnalysisInstructions ?? TEST_ANALYSIS_TASK_INSTRUCTIONS;
  const taskBindings = {
    project: args.overrides?.project,
    testTitle: args.failureDetails.testTitle,
    filePath: args.failureDetails.filePath,
  };
  // Split so the stable contract (output format + rubrics, identical across every
  // test analysis) caches separately from the per-test request header.
  const { request: requestTemplate, contract: contractTemplate } =
    splitTaskInstructions(taskInstructionsTemplate);
  const requestSub = applyMustache(requestTemplate, taskBindings, TEST_ANALYSIS_VARS);
  const contractSub = applyMustache(contractTemplate, taskBindings, TEST_ANALYSIS_VARS);

  const crossProjectBlock =
    args.crossProjectEntries && args.crossProjectEntries.length > 0
      ? buildCrossProjectContext(
          args.crossProjectEntries,
          args.crossProjectTotalCount ?? args.crossProjectEntries.length
        ).trim()
      : undefined;

  const feedbackBlock = args.feedback ? buildFeedbackContext(args.feedback).trim() : undefined;

  return assembleSegments([
    buildSegment(
      'system_prompt',
      'system',
      true,
      resolveSystemPrompt(
        TEST_ANALYSIS_SYSTEM_PROMPT,
        args.overrides?.systemPrompt ?? args.systemPrompt,
        args.overrides?.testAnalysisSystemPrompt
      )
    ),
    buildGeneralContextSegment(args.overrides?.generalContext),
    buildSegment('task_contract', 'user', !contractSub.substituted, contractSub.rendered),
    buildSegment('task_request', 'user', !requestSub.substituted, requestSub.rendered),
    buildSegment('evidence_open', 'user', false, '<evidence>'),
    buildSegment('run_context', 'user', false, buildRunContextBlock(evidence)),
    buildSegment('test_metadata', 'user', false, buildTestMetadataBlock(evidence)),
    buildSegment('environment', 'user', false, buildEnvironmentBlock(evidence)),
    buildSegment(
      'historical_context',
      'user',
      false,
      buildHistoricalContextBlock(args.historicalContext)
    ),
    buildSegment(
      'flakiness_rationale',
      'user',
      false,
      buildFlakinessRationaleBlock(args.historicalContext)
    ),
    buildSegment(
      'regression_context',
      'user',
      false,
      buildRegressionContextBlock(args.regressionContext)
    ),
    buildSegment('cross_project_context', 'user', true, crossProjectBlock),
    buildSegment(
      'prior_in_project_analysis',
      'user',
      false,
      buildPriorInProjectAnalysisBlock(args.priorInProjectAnalysis ?? undefined)
    ),
    buildSegment(
      'step_tree',
      'user',
      false,
      evidence?.stepTree?.length ? `## Step Tree\n${renderStepTree(evidence.stepTree)}` : undefined
    ),
    buildSegment('test_source_frame', 'user', false, buildTestSourceFrameBlock(evidence)),
    buildSegment(
      'page_snapshot',
      'user',
      false,
      evidence?.pageSnapshot ? `## Page Snapshot\n\n${evidence.pageSnapshot}` : undefined
    ),
    buildSegment('recent_actions', 'user', false, buildRecentActionsBlock(evidence)),
    buildSegment('console_log', 'user', false, buildConsoleLogBlock(evidence)),
    buildSegment('network_activity', 'user', false, buildNetworkActivityBlock(evidence)),
    buildSegment(
      'stdout',
      'user',
      false,
      evidence?.stdout ? `## Stdout\n\`\`\`\n${evidence.stdout}\n\`\`\`` : undefined
    ),
    buildSegment(
      'stderr',
      'user',
      false,
      evidence?.stderr ? `## Stderr\n\`\`\`\n${evidence.stderr}\n\`\`\`` : undefined
    ),
    buildSegment(
      'git_diff',
      'user',
      false,
      evidence?.gitDiff ? `## Git Diff\n\`\`\`diff\n${evidence.gitDiff}\n\`\`\`` : undefined
    ),
    buildSegment('user_feedback', 'user', false, feedbackBlock),
    buildSegment('current_failure', 'user', false, buildFailureDetailsBlock(args.failureDetails)),
    buildSegment('evidence_close', 'user', false, '</evidence>'),
  ]);
};

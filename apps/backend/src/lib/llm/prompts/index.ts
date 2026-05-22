import type { FailureEvidence } from '../../parser/failure-extraction.js';
import type { PerFileStep } from '../../parser/report-payload.js';
import type { LLMResponseSchema, PromptSegment, SegmentedPrompt } from '../types/index.js';

const FAILURE_CATEGORY_ENUM = [
  'timeout',
  'element_not_visible',
  'element_not_found',
  'assertion_error',
  'snapshot_mismatch',
  'network_error',
  'api_error',
  'authentication_error',
  'navigation_error',
  'browser_crash',
  'setup_teardown',
  'javascript_error',
  'unknown',
] as const;

/** JSON schema for structured-output test-failure analysis. The `category`
 *  field is optional — the model is asked to populate it only when it actively
 *  disagrees with the heuristic baseline supplied via {{errorCategory}}. The
 *  consensus rule at llmAnalysisQueue.ts:739 lets the heuristic win unless it
 *  was `unknown` or the LLM agrees, so the model's category is only load-
 *  bearing in the `unknown`-tiebreaker case. `analysis` stays required. */
export const TEST_FAILURE_ANALYSIS_SCHEMA: LLMResponseSchema = {
  name: 'submit_test_failure_analysis',
  description:
    'Submit a root-cause analysis of a Playwright test failure. `analysis` is markdown text. `category` is optional — set it only when the heuristic baseline looks wrong.',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['analysis'],
    properties: {
      category: {
        type: 'string',
        enum: [...FAILURE_CATEGORY_ENUM],
        description:
          'Failure category from the fixed enum. OPTIONAL — populate only when you actively disagree with the heuristic baseline provided in the task instructions; otherwise omit.',
      },
      analysis: {
        type: 'string',
        description:
          'Markdown analysis of root cause, what to verify, and a recommended direction. Specific, actionable, anchored in the evidence.',
      },
    },
  },
};

/** Verdict enum mirrored in shared/types ProjectAnalysisVerdict. Keep in sync. */
export const PROJECT_VERDICT_ENUM = ['healthy', 'stabilizing', 'degrading', 'failing'] as const;

/** Structured-output schema for the project-level health analysis. The model
 *  emits a verdict, a short executive summary, and an ordered list of sections.
 *  The UI renders the verdict as a status badge, the summary above the fold,
 *  and the sections as collapsible blocks below. */
export const PROJECT_ANALYSIS_SCHEMA: LLMResponseSchema = {
  name: 'submit_project_health_analysis',
  description:
    'Submit a structured health analysis for a project across its latest runs. The verdict reflects the overall trend across the timeline; the summary is the executive headline; sections expand on health/recommendations/notable trends.',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'summary', 'sections'],
    properties: {
      verdict: {
        type: 'string',
        enum: [...PROJECT_VERDICT_ENUM],
        description:
          'Overall project health verdict. healthy = no failures or only resolved transient ones; stabilizing = failures are decreasing or have been fixed recently; degrading = failures are increasing or new persistent ones appeared; failing = many runs are red.',
      },
      summary: {
        type: 'string',
        description:
          '1–3 sentence executive headline shown above the fold. State the verdict in plain English and mention the most important detail.',
      },
      sections: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['heading', 'body'],
          properties: {
            heading: {
              type: 'string',
              description:
                'Short section title without leading emoji or numbering (e.g., "Health Assessment", "Recommendations", "Notable Trends").',
            },
            body: {
              type: 'string',
              description:
                'Markdown body for the section. Be specific and reference test files or report IDs when relevant. Do NOT repeat the section heading inside the body.',
            },
            codeRefs: {
              type: 'array',
              description:
                'Code references mentioned in this section, e.g. test files or paths under tests/. Used by the UI to render clickable links.',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['file'],
                properties: {
                  file: {
                    type: 'string',
                    description: 'Path to the test file (relative to the repo root if known).',
                  },
                  line: {
                    type: 'integer',
                    minimum: 1,
                    description: 'Optional 1-based line number.',
                  },
                  reportId: {
                    type: 'string',
                    description:
                      'Optional report ID this reference belongs to. When set, the UI links into that specific report; otherwise it links into the latest one.',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

export function resolveSystemPrompt(
  builtInDefault: string,
  legacyCustom?: string,
  perTaskCustom?: string
): string {
  return perTaskCustom?.trim() || legacyCustom?.trim() || builtInDefault;
}

// Tiny `{{var}}` substitution with a per-template allowlist. Logic-free by
// design — no conditionals, no loops, no partials. When substitution replaces
// any text, the resulting segment is marked NOT stable so providers skip
// cache_control on it (the rendered content varies per call).

export interface MustacheSubstitution {
  /** Whether any vars were actually substituted (input != output). */
  substituted: boolean;
  /** Final rendered string. */
  rendered: string;
}

export function applyMustache(
  template: string,
  bindings: Record<string, string | number | boolean | undefined>,
  allowlist: ReadonlySet<string>
): MustacheSubstitution {
  let substituted = false;
  const rendered = template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, name) => {
    if (!allowlist.has(name)) {
      console.warn(`[llm.prompts] mustache var "${name}" not in allowlist — left as-is`);
      return match;
    }
    const value = bindings[name];
    if (value === undefined || value === null) {
      console.warn(`[llm.prompts] mustache var "${name}" has no binding — left as-is`);
      return match;
    }
    substituted = true;
    return String(value);
  });
  return { substituted, rendered };
}

const TEST_ANALYSIS_VARS = new Set([
  'project',
  'testTitle',
  'filePath',
  'errorCategory',
] as const) as ReadonlySet<string>;
const REPORT_SUMMARY_VARS = new Set([
  'reportId',
  'project',
  'totalFailures',
] as const) as ReadonlySet<string>;
const PROJECT_SUMMARY_VARS = new Set([
  'project',
  'totalRuns',
  'passingRuns',
] as const) as ReadonlySet<string>;

export const DEFAULT_SYSTEM_PROMPT =
  'Playwright test failure analyst. Diagnose from the structured evidence below. Cite line numbers, file paths, signatures, and response codes. No filler, no generic advice.';
export const TEST_ANALYSIS_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT;
export const REPORT_SUMMARY_SYSTEM_PROMPT =
  'You are a test lead reviewing a single Playwright CI run. Cluster failures into the smallest set of root causes, prioritize fixes by how many tests each unblocks, and call out patterns that look systemic (shared fixtures, flaky infra) versus one-off. Keep findings concrete — cite specific files, categories, or signatures — and skip generic testing advice.';
export const PROJECT_SUMMARY_SYSTEM_PROMPT =
  'You are a QA lead writing a brief health summary for a Playwright test project across its latest runs. Lead with a verdict and a one-line headline. Distinguish transient flakes from persistent regressions, anchor your verdict on what the most recent runs show, and avoid restating per-run details the reader already has. Be concrete about which tests or areas regressed.';

export const TEST_ANALYSIS_TASK_INSTRUCTIONS = `Test: \`{{testTitle}}\` (project "{{project}}", {{filePath}})
Heuristic category: \`{{errorCategory}}\`. Treat as working hypothesis. Disagree only with evidence.

Reply via the tool schema. \`analysis\` is markdown with these sections, headers verbatim. Sections 1 and 2 are required, section 3 is optional.

## Root Cause
What broke. Anchor every claim to specific evidence: line numbers from Test Source / Step Tree / Stack, console errors, failed requests with status codes, attempt-history divergence. If \`{{errorCategory}}\` is wrong, state the better category and set the \`category\` field. Otherwise omit the heuristic from the prose.

## What to Verify
2–3 concrete next checks to confirm or rule out the root cause. Each must be runnable — a log query, an env flag, a code path to inspect, a repro step. No generic advice.

## Recommendation
Optional. Include only when you can name a specific fix (code edit, config change, infra action). Omit when the right next step is "investigate further". A short code snippet is fine when it's concrete, not illustrative.

Attempt-history rules:
- eventually passed → transient/environmental; lead with retry/wait diagnosis.
- never recovered, same error each attempt → persistent defect; focus on code/state.
- different error per attempt → state leaks between attempts; suspect fixtures.

The canonical Error block is from the first failing attempt. Attempt History shows the full timeline.`;

export const REPORT_SUMMARY_TASK_INSTRUCTIONS = `Summarize the test failures from Playwright report \`{{reportId}}\` for project "{{project}}" ({{totalFailures}} failures total).

Format your response as a markdown document with exactly these three sections, using the headers verbatim (including emojis):

## 🔍 Failure Patterns
Executive summary of the most impactful patterns in this report — which categories dominate, which tests cluster around the same root cause, and which look like one-off vs. systemic issues. Include root-cause hypotheses for each major category here.

## 🛠️ Recommendations
Prioritized, actionable recommendations to reduce failures. Lead with the change that resolves the most tests; follow with quick wins. Be concrete (file paths, locator strategies, fixture changes) rather than generic.

## 📝 Correlations & Notes
Any correlations between failure types (e.g., one infra issue surfacing as multiple categories), suspicious patterns worth investigating, and anything else useful that doesn't fit above. Omit this section only if there are no observations to make.`;

export const PROJECT_SUMMARY_TASK_INSTRUCTIONS = `Analyze the test health for project "{{project}}" across the latest {{totalRuns}} runs ({{passingRuns}} passed cleanly).

Respond with a structured JSON object matching the provided schema. The schema requires:

- **verdict**: one of \`healthy\`, \`stabilizing\`, \`degrading\`, \`failing\` — reflecting the overall trend across the full timeline.
  - \`healthy\`: no failures, or only transient failures that already resolved AND the LATEST run passed.
  - \`stabilizing\`: failures appeared earlier but the most recent runs are clean / improving.
  - \`degrading\`: failures appeared recently or are increasing; new persistent issues introduced.
  - \`failing\`: many runs are red right now, including the latest.
  CRITICAL: a run that has any unexpected or flaky tests is NOT a passing run. Re-read the run table before choosing the verdict — if the latest run shows failures, do not classify the project as \`healthy\` or \`stabilizing\`.
- **summary**: a 1–3 sentence executive headline. State the verdict in plain English and call out the single most important fact.
- **sections**: an ordered list of up to 4 sections. Use these headings in this order (skip a section ONLY if you have no observations for it):
  1. \`Health Assessment\` — overall verdict in detail. Distinguish transient vs persistent failures; call out new issues; note whether they were already resolved.
  2. \`Recommendations\` — top 3 prioritized actions to improve stability. Lead with highest-impact; be specific to what the runs show, not generic advice.
  3. \`Notable Trends\` — failure-rate movement, drifting categories, runs that look unusual.
  4. (optional) \`Risks\` — anything else worth flagging.

Each section body is markdown. Do NOT repeat the section heading inside the body. When referencing tests, include their path under \`codeRefs\` so the UI can render clickable links.

When the data includes a **Top Root Causes** block, treat it as the primary input — those are the actual failure signatures across the window, ranked by occurrence count. Build your "Health Assessment" and "Recommendations" sections around them: identify which one or two root causes are responsible for the most failures, name the specific tests they affect (from the listed affected tests), and call those out by file path in your \`codeRefs\`. The per-run category histograms below are supporting evidence, not the lead.

When a **Persistent Failures** block is present, every entry is a signature that recurred in 3+ distinct runs — these are regressions that aren't being fixed and should anchor the "Recommendations" section.

IMPORTANT: account for the full timeline. If tests were passing before and after a failure, that failure is likely transient/already resolved — do not treat it as an ongoing critical issue. But if the LATEST run is red, the verdict cannot be \`healthy\` regardless of what came before.`;

/** One entry in a test's retry timeline. Drawn from Playwright's
 *  `test.results[]` — each result is one attempt in execution order. */
export interface AttemptSummary {
  /** 1-based attempt number (Playwright UI labels these as Run / Retry #1, #2, …). */
  attempt: number;
  /** 'passed' | 'failed' | 'timedOut' | 'interrupted' | 'skipped' — passthrough from Playwright. */
  status: string;
  /** Error message of this attempt — present for non-passing statuses. */
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
  /** Full retry timeline — all attempts, including passing ones. Rendered as
   *  a `## Attempt History` block so the LLM can reason about flakiness vs
   *  persistence directly. The primary message/stack above still come from
   *  the first failing attempt to keep signature-reuse stable across runs. */
  attempts?: AttemptSummary[];
  evidence?: FailureEvidence;
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

export const buildFeedbackContext = (
  feedback: { comment: string; updatedAt: string } | null
): string => {
  if (!feedback) return '';
  // Human-curated note about THIS test. Weight heavily; if it contradicts the
  // evidence, surface the contradiction in Root Cause rather than ignore it.
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

interface CrossProjectEntry {
  project: string;
  comment: string;
  updatedAt: string;
  errorSignatureMatchesCurrent: boolean;
  latestAnalysis?: { content: string; updatedAt: string; model?: string };
}

/**
 * Same-test feedback in other projects. Each entry is labeled with project name,
 * relative age, and signature-match status so the model can self-prioritize. Capped at 5
 * by the caller (newest first); a tail line is appended when more exist.
 */
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

// Builders emit segments in stability order (most stable first) so providers
// can apply cache_control hints and KV-cache prefixes match across calls.
// `buildTestFailureSegments` is the canonical order.

/**
 * Stable JSON.stringify alternative — sorts object keys recursively so
 * identical inputs produce identical bytes. Used for context blocks that get
 * embedded in prompts (history maps, cross-project entries) so the leading
 * tokens are deterministic for KV-cache prefix matching.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
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
  return `## Prior Analysis${header}\n${prior.analysis.trim()}`;
}

function buildStdoutBlock(evidence: FailureEvidence | undefined): string {
  if (!evidence?.stdout) return '';
  return `## Stdout\n\`\`\`\n${evidence.stdout}\n\`\`\``;
}

function buildStderrBlock(evidence: FailureEvidence | undefined): string {
  if (!evidence?.stderr) return '';
  return `## Stderr\n\`\`\`\n${evidence.stderr}\n\`\`\``;
}

function buildGitDiffBlock(evidence: FailureEvidence | undefined): string {
  if (!evidence?.gitDiff) return '';
  return `## Git Diff\n\`\`\`diff\n${evidence.gitDiff}\n\`\`\``;
}

function formatStepLocation(loc?: { file?: string; line?: number; column?: number }): string {
  if (!loc?.file) return '';
  const line = typeof loc.line === 'number' ? `:${loc.line}` : '';
  return ` (${loc.file}${line})`;
}

function formatStepDuration(ms?: number): string {
  if (typeof ms !== 'number' || ms <= 0) return '';
  if (ms < 1000) return ` [${ms}ms]`;
  return ` [${(ms / 1000).toFixed(1)}s]`;
}

/**
 * Walk the step tree and render an indented bullet list. The errored step (and
 * its ancestors, since errors bubble up) get a `[FAIL]` marker. The errored
 * step's `snippet` (a ~3-line focused code frame) is rendered inline directly
 * under its bullet so the model sees the failing line without scrolling to
 * the separate Test Source segment.
 */
function renderStepTree(steps: PerFileStep[]): string {
  const out: string[] = [];

  const containsError = (s: PerFileStep): boolean => {
    if (s.error?.message) return true;
    return (s.steps ?? []).some(containsError);
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

function buildStepTreeBlock(evidence: FailureEvidence | undefined): string {
  if (!evidence?.stepTree || evidence.stepTree.length === 0) return '';
  return `## Step Tree\n${renderStepTree(evidence.stepTree)}`;
}

function buildPageSnapshotBlock(evidence: FailureEvidence | undefined): string {
  if (!evidence?.pageSnapshot) return '';
  return `## Page Snapshot\n\n${evidence.pageSnapshot}`;
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
    // Namespace prefix (Locator / Page / Test) helps disambiguate the action
    // when the title is just a verb like "click" or "fill". Skip the prefix
    // when the title already includes it (e.g. "Locator.click").
    const ns = a.namespace && a.action && !a.action.includes(a.namespace) ? `${a.namespace}.` : '';
    const tgt = a.target ? ` \`${a.target.replace(/`/g, "'").slice(0, 200)}\`` : '';
    const err = a.error ? ` -- error: ${a.error.replace(/\s+/g, ' ').slice(0, 200)}` : '';
    block += `- ${tStart}\`${ns}${a.action}\`${tgt}${dur}${err}\n`;
  }
  return block;
}

function buildConsoleLogBlock(evidence: FailureEvidence | undefined): string {
  if (!evidence?.consoleEvents || evidence.consoleEvents.length === 0) return '';
  const errors = evidence.consoleEvents.filter((e) => e.level === 'error' || e.level === 'warning');
  const others = evidence.consoleEvents.filter((e) => e.level !== 'error' && e.level !== 'warning');
  // Skip the "other" tail entirely when zero errors/warnings — info/log/debug
  // alone are almost always noise unrelated to the failure.
  if (errors.length === 0) return '';
  let block = `## Console (errors+warnings, +${others.length} other)\n`;
  const render = (events: typeof evidence.consoleEvents) => {
    for (const ev of events) {
      const loc = ev.location?.url
        ? ` @${ev.location.url}${ev.location.lineNumber ? `:${ev.location.lineNumber}` : ''}`
        : '';
      block += `- ${ev.level}: ${ev.text}${loc}\n`;
    }
  };
  render(errors);
  if (others.length > 0) render(others);
  return block;
}

function buildNetworkActivityBlock(evidence: FailureEvidence | undefined): string {
  if (!evidence?.networkEvents || evidence.networkEvents.length === 0) return '';
  const failed = evidence.networkEvents.filter(
    (n) => !!n.failureText || (typeof n.status === 'number' && n.status >= 400)
  );
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
    // Headers are signal on failures, noise on 2xx — drop them for successful
    // requests entirely. Bodies follow the same rule (we already only show
    // response bodies for failures; same for request bodies below).
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
  if (env.userAgent) lines.push(`- user_agent: ${env.userAgent}`);
  if (env.playwrightVersion) lines.push(`- playwright: ${env.playwrightVersion}`);
  if (env.sdkLanguage) lines.push(`- sdk: ${env.sdkLanguage}`);
  if (lines.length === 0) return '';
  return `## Environment\n${lines.join('\n')}`;
}

/** Truncate a single-line summary of an attempt's error message. Strips
 *  newlines so the timeline list stays one bullet per attempt. */
function summarizeAttemptMessage(message: string | undefined, maxChars = 200): string {
  if (!message) return '';
  const oneLine = message.replace(/\s+/g, ' ').trim();
  return oneLine.length > maxChars ? `${oneLine.substring(0, maxChars)}…` : oneLine;
}

/** Comparison-stable signature for grouping attempts that failed the same way.
 *  Mirrors `computeErrorSignature`; kept local so prompts stay self-contained. */
function normalizeAttemptSignature(message: string | undefined): string {
  if (!message) return '';
  return message
    .replace(/\d+/g, 'N')
    .replace(/['"`][^'"`]*['"`]/g, 'S')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 500);
}

/** Pull the "## Root Cause" paragraph from a per-test analysis. Tolerates the
 *  legacy emoji prefix for older stored analyses. */
export function extractRootCauseParagraph(markdown: string, fallbackChars = 600): string {
  if (!markdown) return '';
  const rootCauseRe = /^#{1,3}\s*(?:🔍\s*)?Root Cause\b.*$/im;
  const startMatch = markdown.match(rootCauseRe);
  if (!startMatch) {
    const trimmed = markdown.trim();
    return trimmed.length > fallbackChars
      ? `${trimmed.substring(0, fallbackChars).trim()}…`
      : trimmed;
  }
  const startIdx = (startMatch.index ?? 0) + startMatch[0].length;
  // Stop at the next heading at the same or higher level. The model can use
  // ## or ### so we match both — anything starting with `##` ends the section.
  const tail = markdown.slice(startIdx);
  const endMatch = tail.match(/\n#{1,3}\s/);
  const body = endMatch ? tail.slice(0, endMatch.index) : tail;
  return body.replace(/^\s+|\s+$/g, '');
}

function buildFailureDetailsBlock(failureDetails: FailureDetailsForPrompt): string {
  // Test name / file / location / attempt are covered by the test_metadata
  // segment + the title prefix in task_instructions; attachments are noise
  // unless the LLM can actually open them (it can't). The block focuses on
  // error message + stack trace + attempt timeline.
  let block = '';

  if (failureDetails.attempts && failureDetails.attempts.length > 1) {
    const attempts = failureDetails.attempts;
    const failedAttempts = attempts.filter((a) => a.status !== 'passed');
    const totalFailed = failedAttempts.length;
    const finalAttempt = attempts[attempts.length - 1];
    const finalOutcome = finalAttempt.status === 'passed' ? 'eventually passed' : 'never recovered';

    // Group failed attempts by normalized signature: collapse repeats to
    // "same as #N", flag divergence in the header.
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

    // When errors diverge, give each distinct error more room so the model
    // sees what actually changed between attempts. When they're identical,
    // a tight summary is enough — the first attempt's full message is
    // already in the canonical ## Error block below.
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

export interface CustomPromptOverrides {
  systemPrompt?: string;
  testAnalysisSystemPrompt?: string;
  reportSummarySystemPrompt?: string;
  projectSummarySystemPrompt?: string;
  testAnalysisInstructions?: string;
  reportSummaryInstructions?: string;
  projectSummaryInstructions?: string;
  /** Failure category from the heuristic baseline — useful as a {{errorCategory}}
   *  binding when the user wants to bias the LLM toward / away from a baseline. */
  errorCategory?: string;
  /** Project name for binding in test/report/project instructions. */
  project?: string;
}

export interface PriorInProjectAnalysis {
  analysis: string;
  category?: string;
  model?: string;
  updatedAt?: string;
}

export const buildTestFailureSegments = (args: {
  systemPrompt?: string;
  failureDetails: FailureDetailsForPrompt;
  historicalContext?: HistoricalContextInput;
  feedback?: { comment: string; updatedAt: string } | null;
  crossProjectEntries?: CrossProjectEntry[];
  crossProjectTotalCount?: number;
  /** Most recent completed LLM analysis for this same (testId, fileId, project)
   *  from any prior run. Rendered as the `prior_in_project_analysis` segment. */
  priorInProjectAnalysis?: PriorInProjectAnalysis | null;
  overrides?: CustomPromptOverrides;
}): SegmentedPrompt => {
  const segments: PromptSegment[] = [];
  const evidence = args.failureDetails.evidence;

  // --- Cacheable prefix: system + task instructions. The output-schema text
  //     segment is gone — the tool schema object alone binds the response. ---
  segments.push({
    id: 'system_prompt',
    role: 'system',
    stable: true,
    content: resolveSystemPrompt(
      TEST_ANALYSIS_SYSTEM_PROMPT,
      args.overrides?.systemPrompt ?? args.systemPrompt,
      args.overrides?.testAnalysisSystemPrompt
    ),
  });

  const taskInstructionsTemplate =
    args.overrides?.testAnalysisInstructions ?? TEST_ANALYSIS_TASK_INSTRUCTIONS;
  const taskSub = applyMustache(
    taskInstructionsTemplate,
    {
      project: args.overrides?.project,
      testTitle: args.failureDetails.testTitle,
      filePath: args.failureDetails.filePath,
      errorCategory: args.overrides?.errorCategory,
    },
    TEST_ANALYSIS_VARS
  );
  segments.push({
    id: 'task_instructions',
    role: 'user',
    stable: !taskSub.substituted,
    content: taskSub.rendered,
  });

  // --- Run-level context (git commit, CI build, suite/tags/annotations,
  //     environment). Mostly stable across retries of the same test. ---
  const runContext = buildRunContextBlock(evidence);
  if (runContext) {
    segments.push({ id: 'run_context', role: 'user', stable: false, content: runContext });
  }
  const testMetadata = buildTestMetadataBlock(evidence);
  if (testMetadata) {
    segments.push({ id: 'test_metadata', role: 'user', stable: false, content: testMetadata });
  }
  const envBlock = buildEnvironmentBlock(evidence);
  if (envBlock) {
    segments.push({ id: 'environment', role: 'user', stable: false, content: envBlock });
  }

  // --- Historical context (stable per-test). ---
  const history = buildHistoricalContextBlock(args.historicalContext);
  if (history) {
    segments.push({ id: 'historical_context', role: 'user', stable: false, content: history });
  }
  const flakinessBlock = buildFlakinessRationaleBlock(args.historicalContext);
  if (flakinessBlock) {
    segments.push({
      id: 'flakiness_rationale',
      role: 'user',
      stable: false,
      content: flakinessBlock,
    });
  }
  if (args.crossProjectEntries && args.crossProjectEntries.length > 0) {
    segments.push({
      id: 'cross_project_context',
      role: 'user',
      stable: true,
      content: buildCrossProjectContext(
        args.crossProjectEntries,
        args.crossProjectTotalCount ?? args.crossProjectEntries.length
      ).trim(),
    });
  }
  const priorBlock = buildPriorInProjectAnalysisBlock(args.priorInProjectAnalysis ?? undefined);
  if (priorBlock) {
    segments.push({
      id: 'prior_in_project_analysis',
      role: 'user',
      stable: false,
      content: priorBlock,
    });
  }

  // --- Evidence: code frame + step tree + page snapshot + actions/console/network. ---
  const stepTreeBlock = buildStepTreeBlock(evidence);
  if (stepTreeBlock) {
    segments.push({ id: 'step_tree', role: 'user', stable: false, content: stepTreeBlock });
  }
  const sourceFrame = buildTestSourceFrameBlock(evidence);
  if (sourceFrame) {
    segments.push({ id: 'test_source_frame', role: 'user', stable: false, content: sourceFrame });
  }
  const pageSnapshot = buildPageSnapshotBlock(evidence);
  if (pageSnapshot) {
    segments.push({ id: 'page_snapshot', role: 'user', stable: false, content: pageSnapshot });
  }
  const recentActions = buildRecentActionsBlock(evidence);
  if (recentActions) {
    segments.push({ id: 'recent_actions', role: 'user', stable: false, content: recentActions });
  }
  const consoleLog = buildConsoleLogBlock(evidence);
  if (consoleLog) {
    segments.push({ id: 'console_log', role: 'user', stable: false, content: consoleLog });
  }
  const networkActivity = buildNetworkActivityBlock(evidence);
  if (networkActivity) {
    segments.push({
      id: 'network_activity',
      role: 'user',
      stable: false,
      content: networkActivity,
    });
  }

  // --- Captured stdio / local changes. ---
  const stdout = buildStdoutBlock(evidence);
  if (stdout) {
    segments.push({ id: 'stdout', role: 'user', stable: false, content: stdout });
  }
  const stderr = buildStderrBlock(evidence);
  if (stderr) {
    segments.push({ id: 'stderr', role: 'user', stable: false, content: stderr });
  }
  const gitDiff = buildGitDiffBlock(evidence);
  if (gitDiff) {
    segments.push({ id: 'git_diff', role: 'user', stable: false, content: gitDiff });
  }

  // --- Recency-biased tail: user feedback right before the error itself. ---
  if (args.feedback) {
    segments.push({
      id: 'user_feedback',
      role: 'user',
      stable: false,
      content: buildFeedbackContext(args.feedback).trim(),
    });
  }

  segments.push({
    id: 'current_failure',
    role: 'user',
    stable: false,
    content: buildFailureDetailsBlock(args.failureDetails),
  });

  return { segments };
};

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

export const buildReportSummarySegments = (args: {
  systemPrompt?: string;
  reportId: string;
  categories: Record<string, number>;
  errorGroups: Array<{
    signature: string;
    category: string;
    count: number;
    sampleMessage: string;
    affectedTests: string[];
  }>;
  perTestAnalyses: Array<{ testTitle: string; category: string; analysis: string }>;
  perTestFeedback?: Array<{ testTitle?: string; comment: string; updatedAt: string }>;
  trendContext?: ReportSummaryTrendContext;
  overrides?: CustomPromptOverrides;
}): SegmentedPrompt => {
  const segments: PromptSegment[] = [];

  segments.push({
    id: 'system_prompt',
    role: 'system',
    stable: true,
    content: resolveSystemPrompt(
      REPORT_SUMMARY_SYSTEM_PROMPT,
      args.overrides?.systemPrompt ?? args.systemPrompt,
      args.overrides?.reportSummarySystemPrompt
    ),
  });

  const totalFailures = Object.values(args.categories).reduce((sum, c) => sum + c, 0);
  // Same unified path as test-analysis: default and override both go through
  // applyMustache.
  const reportInstructionsTemplate =
    args.overrides?.reportSummaryInstructions ?? REPORT_SUMMARY_TASK_INSTRUCTIONS;
  const reportSub = applyMustache(
    reportInstructionsTemplate,
    {
      reportId: args.reportId,
      project: args.overrides?.project,
      totalFailures,
    },
    REPORT_SUMMARY_VARS
  );
  segments.push({
    id: 'task_instructions',
    role: 'user',
    stable: !reportSub.substituted,
    content: reportSub.rendered,
  });

  let dataBlock = `## Report: ${args.reportId}\n\n`;
  dataBlock += `## Failure Categories (${totalFailures} total failures)\n`;
  for (const [cat, count] of Object.entries(args.categories).sort((a, b) =>
    b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])
  )) {
    dataBlock += `- **${cat}**: ${count} failures\n`;
  }
  dataBlock += '\n';

  if (args.errorGroups.length > 0) {
    dataBlock += `## Top Error Groups\n`;
    for (const group of args.errorGroups.slice(0, 10)) {
      dataBlock += `### ${group.category} (${group.count}x across ${group.affectedTests.length} tests)\n`;
      dataBlock += `\`\`\`\n${group.sampleMessage.substring(0, 500)}\n\`\`\`\n`;
      const affected = [...group.affectedTests].sort();
      dataBlock += `Affected: ${affected.slice(0, 5).join(', ')}${affected.length > 5 ? ` +${affected.length - 5} more` : ''}\n\n`;
    }
  }

  if (args.perTestAnalyses.length > 0) {
    // Rank analyses so the model sees a representative sample, not the first
    // 20 in arbitrary arrival order. Strategy: take the top 3 dominant
    // categories (by failure count in this report), include up to 5 tests per
    // category, hard-cap at 20 total. Within each category, ordering is
    // preserved from the input (DB ordering) for cache prefix stability.
    const TOP_CATEGORIES = 3;
    const PER_CATEGORY_CAP = 5;
    const TOTAL_CAP = 20;
    const topCategories = Object.entries(args.categories)
      .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
      .slice(0, TOP_CATEGORIES)
      .map(([cat]) => cat);
    const ranked: typeof args.perTestAnalyses = [];
    for (const cat of topCategories) {
      const forCat = args.perTestAnalyses
        .filter((a) => a.category === cat)
        .slice(0, PER_CATEGORY_CAP);
      ranked.push(...forCat);
    }
    // Fill remaining budget with whatever didn't make the top-3 (other
    // categories, unknowns) so the model still sees the tail.
    if (ranked.length < TOTAL_CAP) {
      const seen = new Set(ranked.map((a) => `${a.testTitle}::${a.category}`));
      for (const a of args.perTestAnalyses) {
        if (ranked.length >= TOTAL_CAP) break;
        if (seen.has(`${a.testTitle}::${a.category}`)) continue;
        ranked.push(a);
      }
    }
    const shown = ranked.slice(0, TOTAL_CAP);

    dataBlock += `## Per-Test Analyses (root cause per test, top categories first)\n`;
    for (const analysis of shown) {
      const rootCause = extractRootCauseParagraph(analysis.analysis);
      const indented = rootCause.replace(/\n/g, '\n  ');
      dataBlock += `- **${analysis.testTitle}** [${analysis.category}]:\n  ${indented}\n`;
    }
    if (args.perTestAnalyses.length > shown.length) {
      dataBlock += `\n_…and ${args.perTestAnalyses.length - shown.length} more per-test analyses not shown._\n`;
    }
    dataBlock += '\n';
  }

  segments.push({
    id: 'report_data',
    role: 'user',
    stable: false,
    content: dataBlock.trimEnd(),
  });

  if (args.trendContext) {
    segments.push({
      id: 'trend_context',
      role: 'user',
      stable: false,
      content: renderReportTrendContext(args.trendContext, args.perTestAnalyses),
    });
  }

  if (args.perTestFeedback && args.perTestFeedback.length > 0) {
    segments.push({
      id: 'per_test_feedback',
      role: 'user',
      stable: false,
      content: buildPerTestFeedbackContext(args.perTestFeedback).trim(),
    });
  }

  return { segments };
};

const formatMs = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m ${rem}s`;
};

/** First two path segments, e.g. `tests/auth/login.spec.ts` → `tests/auth`.
 *  Falls back to the dirname when there's only one segment, or '.' when the
 *  path is empty. Used to surface "X failures are in tests/auth/" insights. */
function topDirectory(filePath: string): string {
  if (!filePath) return '.';
  const norm = filePath.replace(/\\/g, '/');
  const parts = norm.split('/').filter(Boolean);
  if (parts.length === 0) return '.';
  if (parts.length === 1) return parts[0];
  return `${parts[0]}/${parts[1]}`;
}

/**
 * Compute short, model-readable insights from the newly-failed set:
 *   - directory dominance: ≥50% of new failures share a top-level dir
 *   - category dominance: ≥50% share a heuristic category (looked up from
 *     perTestAnalyses by test title — best-effort, skip when missing)
 * Returns at most one line per insight type. Returns [] when nothing notable.
 */
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

const renderReportTrendContext = (
  ctx: ReportSummaryTrendContext,
  perTestAnalyses: Array<{ testTitle: string; category: string; analysis: string }> = []
): string => {
  const { previousReport, counts } = ctx;
  const prevLabel = previousReport.displayNumber
    ? `#${previousReport.displayNumber}`
    : previousReport.title || previousReport.reportId.slice(0, 8);

  const lines: string[] = [];
  lines.push(`## Trend vs previous report (${prevLabel} from ${previousReport.createdAt})`);
  lines.push('');
  lines.push(
    'Use this to call out what changed in your "Failure Patterns" and "Correlations" sections.'
  );
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
        `- ${d.title} (${d.filePath}): ${formatMs(d.durationA)} → ${formatMs(d.durationB)} (${sign}${(d.deltaPct * 100).toFixed(0)}%)`
      );
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
};

/** Aggregated root cause across the project's latest runs. Built by the
 *  queue worker and passed in here so the prompt template stays pure. */
export interface ProjectRootCause {
  signature: string;
  category: string;
  occurrences: number;
  reportsAffected: number;
  affectedTests: Array<{ testId: string; title: string; filePath: string }>;
  sampleMessage: string;
  latestRootCause?: string;
  latestAnalysisReportId?: string;
}

export const buildProjectSummarySegments = (args: {
  systemPrompt?: string;
  project: string;
  runs: Array<{
    reportId: string;
    createdAt: string;
    stats: { total: number; expected: number; unexpected: number; flaky: number; skipped: number };
    totalFailures: number;
    categories: Record<string, number>;
    llmSummary?: string;
  }>;
  rootCauses?: ProjectRootCause[];
  persistentFailures?: ProjectRootCause[];
  overrides?: CustomPromptOverrides;
}): SegmentedPrompt => {
  const segments: PromptSegment[] = [];

  segments.push({
    id: 'system_prompt',
    role: 'system',
    stable: true,
    content: resolveSystemPrompt(
      PROJECT_SUMMARY_SYSTEM_PROMPT,
      args.overrides?.systemPrompt ?? args.systemPrompt,
      args.overrides?.projectSummarySystemPrompt
    ),
  });

  const totalRuns = args.runs.length;
  // A run is "with failures" when ANY stat marks it red — not when the
  // secondary failure-summary task happened to populate `totalFailures`.
  // The failure-summary cache lags behind ingestion, so relying on it alone
  // caused the model to label genuinely-failed runs as PASS.
  const runHasFailures = (r: (typeof args.runs)[number]): boolean =>
    r.totalFailures > 0 || (r.stats?.unexpected ?? 0) > 0 || (r.stats?.flaky ?? 0) > 0;
  const runsWithFailures = args.runs.filter(runHasFailures);
  const passingRuns = totalRuns - runsWithFailures.length;

  // Unified path: default and override both go through applyMustache.
  const projectInstructionsTemplate =
    args.overrides?.projectSummaryInstructions ?? PROJECT_SUMMARY_TASK_INSTRUCTIONS;
  const projectSub = applyMustache(
    projectInstructionsTemplate,
    {
      project: args.project,
      totalRuns,
      passingRuns,
    },
    PROJECT_SUMMARY_VARS
  );
  segments.push({
    id: 'task_instructions',
    role: 'user',
    stable: !projectSub.substituted,
    content: projectSub.rendered,
  });

  const latestRun = args.runs[0];
  const latestStatus = latestRun ? (runHasFailures(latestRun) ? 'FAILURES' : 'PASS') : 'unknown';

  let dataBlock = `Project: "${args.project}", latest ${totalRuns} runs.\n\n`;
  dataBlock += `**Overview:** ${passingRuns} of ${totalRuns} runs passed cleanly (no failures). ${runsWithFailures.length} runs had failures.\n`;
  dataBlock += `**Latest run status:** ${latestStatus}${latestRun ? ` (${latestRun.reportId})` : ''} — use this to anchor the verdict.\n\n`;

  if (args.rootCauses && args.rootCauses.length > 0) {
    dataBlock += `## Top Root Causes (across last ${totalRuns} runs)\n`;
    for (let i = 0; i < args.rootCauses.length; i++) {
      const rc = args.rootCauses[i];
      dataBlock += `\n### ${i + 1}. \`${rc.category}\` — ${rc.occurrences}× across ${rc.reportsAffected} run${rc.reportsAffected === 1 ? '' : 's'}\n`;
      const sample = rc.sampleMessage.replace(/\s+/g, ' ').trim();
      const sampleTrunc = sample.length > 300 ? `${sample.substring(0, 300)}…` : sample;
      if (sampleTrunc) {
        dataBlock += `- **Error:** \`${sampleTrunc}\`\n`;
      }
      const testsList = rc.affectedTests
        .slice(0, 3)
        .map((t) => `\`${t.title}\` (${t.filePath})`)
        .join(', ');
      const more = rc.affectedTests.length > 3 ? ` +${rc.affectedTests.length - 3} more` : '';
      dataBlock += `- **Affected tests:** ${testsList}${more}\n`;
      if (rc.latestRootCause) {
        const indented = rc.latestRootCause.replace(/\n/g, '\n  ');
        dataBlock += `- **Prior LLM root cause:**\n  ${indented}\n`;
      }
    }
    dataBlock += '\n';
  }

  if (args.persistentFailures && args.persistentFailures.length > 0) {
    dataBlock += `## Persistent Failures (signature seen in ≥3 distinct runs)\n`;
    for (const rc of args.persistentFailures) {
      const titles = rc.affectedTests
        .slice(0, 3)
        .map((t) => `\`${t.title}\``)
        .join(', ');
      const more = rc.affectedTests.length > 3 ? ` +${rc.affectedTests.length - 3} more` : '';
      dataBlock += `- \`${rc.category}\` — ${rc.reportsAffected} runs, tests: ${titles}${more}\n`;
    }
    dataBlock += '\n';
  }

  dataBlock += `Runs are listed from most recent to oldest:\n\n`;

  for (const run of args.runs) {
    const status = runHasFailures(run) ? 'FAILURES' : 'PASS';
    dataBlock += `### Run ${run.reportId} (${run.createdAt}) — ${status}\n`;
    dataBlock += `- Tests: ${run.stats.total} total, ${run.stats.expected} passed, ${run.stats.unexpected} failed, ${run.stats.flaky} flaky, ${run.stats.skipped} skipped\n`;
    if (runHasFailures(run)) {
      const categoryEntries = Object.entries(run.categories);
      if (categoryEntries.length > 0) {
        for (const [cat, count] of categoryEntries.sort((a, b) =>
          b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])
        )) {
          dataBlock += `  - ${cat}: ${count}\n`;
        }
      }
      if (run.llmSummary) {
        dataBlock += `- Summary: ${run.llmSummary.substring(0, 300)}\n`;
      }
    }
    dataBlock += '\n';
  }

  segments.push({
    id: 'project_data',
    role: 'user',
    stable: false,
    content: dataBlock.trimEnd(),
  });

  return { segments };
};

/** Render a SegmentedPrompt to a single human-readable string for debug
 *  storage and for legacy reuse-detection regexes. Order matches segments. */
export function renderSegmentsForDebug(prompt: SegmentedPrompt): string {
  return prompt.segments
    .filter((s) => s.role !== 'system')
    .map((s) => s.content)
    .join('\n\n');
}

// Stable-stringify utility re-export so callers building cross-project entries
// or other dynamic blocks can produce deterministic bytes.
export { stableStringify };

/**
 * Some local models emit markdown with literal `\n` and `\t` escape
 * sequences instead of actual newlines/tabs — typically when they were asked
 * to "respond in JSON" but produced just the value string without the JSON
 * envelope. The result renders as `\n` characters in the UI.
 *
 * Detect-and-unescape only when at least one such sequence is present, so
 * legitimate text containing a literal backslash-n is left alone.
 */
export function unescapeLiteralNewlines(text: string): string {
  if (!text || !/\\[ntr"]/.test(text)) return text;
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"');
}

/**
 * Truncate text to at most `maxChars` while keeping the head and tail intact.
 * The middle is replaced with a `[…N chars omitted…]` marker so the most
 * informative parts (top of error, last frames of stack) survive.
 *
 * If the text is already short enough, returns it unchanged. If maxChars is
 * smaller than the marker itself, returns a head-only truncation.
 */
export function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const marker = (omitted: number) => `\n[… ${omitted} chars omitted …]\n`;
  const sample = marker(text.length);
  if (maxChars <= sample.length + 8) {
    return `${text.substring(0, Math.max(0, maxChars - 1))}…`;
  }
  const keep = maxChars - sample.length;
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  const omitted = text.length - keep;
  return text.substring(0, head) + marker(omitted) + text.substring(text.length - tail);
}

// Shrinks a SegmentedPrompt in priority order until it fits a char budget.
// Callers convert token budgets to char budgets via the chars-per-token ratio
// from the initial count, avoiding repeated count_tokens round-trips.
//
// Priority order (lowest-priority changes first; cross-project survives a long
// time because a validated prior analysis on the same signature is the single
// strongest predictor of the right diagnosis):
// 1. attachment list lines — drop names, keep count.
// 2. page_snapshot — DOM markdown can be huge; tail-truncate to 1500 chars.
// 3. network_activity — tail-truncate (failed-first ordering means head matters).
// 4. console_log — tail-truncate.
// 5. recent_actions — tail-truncate.
// 6. historical_context — drop the categories line.
// 7. middle of current_failure — preserve head + tail (error top + stack tail).
// 8. user_feedback — drop entirely.
// 9. cross_project_context — drop entirely (last-resort).
// 10. middle-truncate everything non-stable to fit.

export interface PromptFitResult {
  prompt: SegmentedPrompt;
  /** Human-readable changes applied, in order. Empty if untouched. */
  changes: string[];
}

const segmentChars = (p: SegmentedPrompt): number =>
  p.segments.reduce((sum, s) => sum + s.content.length, 0);

const dropSegment = (p: SegmentedPrompt, id: string): SegmentedPrompt | null => {
  const idx = p.segments.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  return { segments: p.segments.filter((_, i) => i !== idx) };
};

const transformSegment = (
  p: SegmentedPrompt,
  id: string,
  fn: (content: string) => string
): SegmentedPrompt | null => {
  const idx = p.segments.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  const next = [...p.segments];
  const newContent = fn(next[idx].content);
  if (newContent === next[idx].content) return null;
  next[idx] = { ...next[idx], content: newContent };
  return { segments: next };
};

/** Drop the bullet list under `## Attachments` header but keep the count. */
function shrinkAttachmentList(content: string): string {
  const re = /## Attachments\n((?:- .*\n)+)\n?/;
  const match = content.match(re);
  if (!match) return content;
  const count = match[1].trim().split('\n').length;
  return content.replace(re, `## Attachments\n_(${count} attachments — names omitted)_\n\n`);
}

/** Replace each fenced block with a middle-truncated copy at the given size. */
function shrinkFencedBlocks(content: string, blockMax: number): string {
  return content.replace(/```([\s\S]*?)```/g, (_full, body: string) => {
    if (body.length <= blockMax) return `\`\`\`${body}\`\`\``;
    return `\`\`\`${truncateMiddle(body, blockMax)}\`\`\``;
  });
}

/** Drop the recent-categories line — least informative when budget tight. */
function shrinkHistoricalContext(content: string): string {
  return content.replace(/- Recent failure categories.*\n/, '');
}

/** Cap a block to a max char count by truncating from the tail (keeps the
 *  header + first entries, drops the older ones). Used for evidence segments
 *  whose entries are ordered "most informative first." */
function truncateTail(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return `${content.substring(0, maxChars)}\n[… truncated to fit budget …]`;
}

/**
 * Fit a SegmentedPrompt to `charsBudget` by applying shrink steps in priority
 * order until size <= budget or all steps are exhausted. Stable segments
 * (system_prompt, task_instructions) are never touched — they're the
 * cacheable prefix and dropping them would defeat caching for marginal char
 * savings.
 */
export function fitPromptToBudget(prompt: SegmentedPrompt, charsBudget: number): PromptFitResult {
  if (segmentChars(prompt) <= charsBudget) {
    return { prompt, changes: [] };
  }

  const changes: string[] = [];
  let p = prompt;

  const tryStep = (
    label: string,
    apply: (current: SegmentedPrompt) => SegmentedPrompt | null
  ): boolean => {
    if (segmentChars(p) <= charsBudget) return true;
    const next = apply(p);
    if (next && segmentChars(next) < segmentChars(p)) {
      p = next;
      changes.push(label);
    }
    return segmentChars(p) <= charsBudget;
  };

  if (
    tryStep('omitted attachment names', (cur) =>
      transformSegment(cur, 'current_failure', shrinkAttachmentList)
    )
  ) {
    return { prompt: p, changes };
  }

  // Evidence segments — tail-truncate before dropping anything. Each block's
  // most-informative entries are at the top (failed network requests first,
  // error console messages first, errored action last) so head-preserving
  // truncation keeps the highest-signal content.
  for (const { id, cap } of [
    { id: 'page_snapshot', cap: 1500 },
    { id: 'network_activity', cap: 2000 },
    { id: 'console_log', cap: 1200 },
    { id: 'recent_actions', cap: 1000 },
  ]) {
    if (
      tryStep(`tail-truncated ${id} to ${cap} chars`, (cur) =>
        transformSegment(cur, id, (c) => truncateTail(c, cap))
      )
    ) {
      return { prompt: p, changes };
    }
  }

  if (
    tryStep('shrunk historical context', (cur) =>
      transformSegment(cur, 'historical_context', shrinkHistoricalContext)
    )
  ) {
    return { prompt: p, changes };
  }

  // Middle-truncate fenced blocks in current_failure (error message + stack trace).
  // Iteratively shrink with progressively tighter limits until we fit.
  for (const blockMax of [8000, 4000, 2000, 1000]) {
    if (
      tryStep(`truncated error/stack to ${blockMax} chars`, (cur) =>
        transformSegment(cur, 'current_failure', (c) => shrinkFencedBlocks(c, blockMax))
      )
    ) {
      return { prompt: p, changes };
    }
  }

  if (tryStep('dropped user feedback', (cur) => dropSegment(cur, 'user_feedback'))) {
    return { prompt: p, changes };
  }

  // Cross-project context drops only after every other shrink option is
  // exhausted — a validated prior analysis on the same signature is the
  // single strongest predictor of the right diagnosis.
  if (
    tryStep('dropped cross-project context', (cur) => dropSegment(cur, 'cross_project_context'))
  ) {
    return { prompt: p, changes };
  }

  // Last resort: middle-truncate every non-stable segment to its share of the budget.
  const stableChars = p.segments
    .filter((s) => s.stable)
    .reduce((sum, s) => sum + s.content.length, 0);
  const varyingBudget = Math.max(1000, charsBudget - stableChars);
  const varyingCount = p.segments.filter((s) => !s.stable).length;
  if (varyingCount > 0) {
    const perSegment = Math.floor(varyingBudget / varyingCount);
    p = {
      segments: p.segments.map((s) =>
        s.stable ? s : { ...s, content: truncateMiddle(s.content, perSegment) }
      ),
    };
    changes.push(`hard-truncated varying segments to ${perSegment} chars each`);
  }

  return { prompt: p, changes };
}

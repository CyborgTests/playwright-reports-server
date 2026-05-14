import { createHash } from 'node:crypto';
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

/** JSON schema for structured-output test-failure analysis. Mirrors the text
 *  response format documented in FAILURE_CATEGORY_SCHEMA so heuristics work
 *  identically whether the provider returns text or schema-conformant JSON. */
export const TEST_FAILURE_ANALYSIS_SCHEMA: LLMResponseSchema = {
  name: 'submit_test_failure_analysis',
  description:
    'Submit categorized analysis of a Playwright test failure. Choose category from the fixed enum; analysis is markdown text; isNew indicates first-occurrence vs recurring.',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['category', 'analysis', 'isNew'],
    properties: {
      category: {
        type: 'string',
        enum: [...FAILURE_CATEGORY_ENUM],
        description: 'Failure category from the fixed enum.',
      },
      analysis: {
        type: 'string',
        description:
          'Markdown analysis of root cause, suggested fix, and observations. Specific, actionable, concise.',
      },
      isNew: {
        type: 'boolean',
        description: 'true when this failure signature has not been seen before; false otherwise.',
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

export const getCustomSystemPrompt = (systemPrompt?: string): string =>
  systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

// Tiny `{{var}}` substitution with a per-template allowlist. Logic-free by
// design — no conditionals, no loops, no partials. When substitution replaces
// any text, the resulting segment is marked NOT templateOnly so promptVersion
// reflects that this prompt is data-bearing rather than a stable template.

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

/**
 * Stable categorization enum + JSON output schema. Lives in its own segment so
 * the provider can mark it cacheable: it never varies across calls.
 */
const FAILURE_CATEGORY_SCHEMA = `1. A failure **category** — pick exactly one from this fixed enum:
   - **timeout** — Playwright's TimeoutError or a test-level timeout, with no specific locator/visibility context
   - **element_not_visible** — \`expect(locator).toBeVisible()\` (or similar) timed out waiting for an element to appear/become interactable
   - **element_not_found** — locator resolved to 0 elements, or strict-mode violation
   - **assertion_error** — test-logic value mismatch (toEqual/toMatch/toContain/...) without timeout or locator context
   - **snapshot_mismatch** — visual / screenshot / toMatchSnapshot failure
   - **network_error** — \`net::ERR_*\`, ECONNREFUSED/ECONNRESET, transport-layer failure
   - **api_error** — explicit 4xx/5xx response from the app under test (non-auth)
   - **authentication_error** — 401/403, "Unauthorized", "Forbidden", or login/credential failures
   - **navigation_error** — page.goto/reload failure, frame detached, navigation timeout (when not a network transport error)
   - **browser_crash** — "Target closed", "Page crashed", browser/context disconnected
   - **setup_teardown** — error originating in beforeAll/afterAll/beforeEach/afterEach/fixture
   - **javascript_error** — ReferenceError/SyntaxError/TypeError, page.evaluate failures, uncaught promise rejections
   - **unknown** — only when none of the above clearly apply
2. A concise **analysis** of the root cause
3. A suggested **fix**
4. Whether this appears to be a **new issue** or a recurring pattern

Respond in JSON format: { "category": "...", "analysis": "markdown text", "isNew": true/false }`;

export const DEFAULT_SYSTEM_PROMPT =
  'You are an expert test automation engineer and test failure analyst with deep knowledge of Playwright, testing best practices, and common failure patterns. Your role is to analyze test failures and suggest concrete improvements. Responses must be specific, actionable, and concise.';

export const TEST_ANALYSIS_TASK_INSTRUCTIONS = `Analyze the Playwright test failure for \`{{testTitle}}\` in project "{{project}}" ({{filePath}}). The heuristic baseline category for this failure is \`{{errorCategory}}\` — use it as a hint, not a verdict. Provide the response specified by the schema above.

The \`analysis\` field MUST be a markdown document organized into exactly these three sections, in order, using the headers verbatim (including emojis):

## 🔍 Root Cause
A concise diagnosis of why the test failed — symptom, the underlying cause, and which code/state is responsible. Cite specific lines from the stack trace where helpful.

## 🛠️ Fix & Best Practice
The recommended fix and any related best practice that prevents this class of failure (e.g., proper waiting strategies, selector resilience, fixture isolation). Be specific to the failure category — don't recite generic advice.

## 📝 Code Snippet
A minimal Playwright code example showing the fix. Use a fenced \`\`\`ts\`\`\` block. If no code change is appropriate (e.g., transient infra failure), state that explicitly here in one short line instead of inventing a snippet.

When an Attempt History is present, use it to judge flakiness vs persistence:
- "eventually passed" → likely transient/environmental; recommend retry tuning, not a code fix.
- "never recovered" with the same error each attempt → genuine failure; focus on root cause.
- Different error per attempt → the test is unstable; report state may be leaking between attempts.

The primary Error Message and Stack Trace below come from the FIRST failing attempt; the Attempt History summarizes all attempts so you can see the full timeline.`;

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
  return `\n## Prior User Feedback\n${feedback.comment}\nUpdated: ${relativeTime(feedback.updatedAt)}\n`;
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
  let block = `\n## Same Test in Other Projects\n`;
  for (const e of entries) {
    const sig = e.errorSignatureMatchesCurrent ? 'matches' : 'differs';
    block += `\n### Project ${e.project} — feedback updated ${relativeTime(e.updatedAt)} — error signature: ${sig}\n`;
    block += `${e.comment}\n`;
    if (e.latestAnalysis) {
      const modelInfo = e.latestAnalysis.model ? `, model: ${e.latestAnalysis.model}` : '';
      block += `Latest analysis there (${relativeTime(e.latestAnalysis.updatedAt)}${modelInfo}):\n${e.latestAnalysis.content}\n`;
    }
  }
  if (totalCount > entries.length) {
    block += `\n… and ${totalCount - entries.length} more not shown.\n`;
  }
  return block;
};

// Builders produce SegmentedPrompt — segments emitted in stability order so
// providers can apply cache_control hints (Anthropic) and the leading token
// prefix matches across calls (OpenAI / LM Studio KV cache). Order:
// system_prompt → output_schema → task_instructions → historical_context →
// cross_project → user_feedback → current_failure. The first three are the
// fully-stable cacheable prefix; per-test stable segments cache for retries
// of the same test; varying segments come last.

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

function buildHistoricalContextBlock(historicalContext?: {
  totalRuns?: number;
  recentFailureCount?: number;
  isFlaky?: boolean;
  previousCategories?: string[];
  isNewFailure?: boolean;
}): string {
  if (!historicalContext) return '';
  let block = `## Historical Context\n`;
  if (historicalContext.totalRuns) {
    block += `- Total runs for this test: ${historicalContext.totalRuns}\n`;
  }
  if (historicalContext.recentFailureCount) {
    block += `- Recent failures: ${historicalContext.recentFailureCount}\n`;
  }
  if (historicalContext.isFlaky) {
    block += `- This test is flagged as flaky\n`;
  }
  if (historicalContext.isNewFailure === true) {
    block += `- This failure signature has NOT been seen before — likely a new issue\n`;
  } else if (historicalContext.isNewFailure === false) {
    block += `- This failure signature has been seen before — recurring issue\n`;
  }
  if (historicalContext.previousCategories && historicalContext.previousCategories.length > 0) {
    // Sorted for deterministic output (KV-cache prefix stability).
    block += `- Previous failure categories: ${[...historicalContext.previousCategories].sort().join(', ')}\n`;
  }
  return block;
}

/** Truncate a single-line summary of an attempt's error message. Strips
 *  newlines so the timeline list stays one bullet per attempt. */
function summarizeAttemptMessage(message: string | undefined, maxChars = 200): string {
  if (!message) return '';
  const oneLine = message.replace(/\s+/g, ' ').trim();
  return oneLine.length > maxChars ? `${oneLine.substring(0, maxChars)}…` : oneLine;
}

function buildFailureDetailsBlock(failureDetails: FailureDetailsForPrompt): string {
  let block = `## Test Details\n`;
  block += `- **Test:** ${failureDetails.testTitle}\n`;
  block += `- **File:** ${failureDetails.filePath}\n`;
  if (failureDetails.location) {
    block += `- **Location:** ${failureDetails.location.file}:${failureDetails.location.line}:${failureDetails.location.column}\n`;
  }
  block += `- **Attempt:** ${failureDetails.attempt}\n`;
  block += `- **Status:** ${failureDetails.status}\n\n`;

  // Attempt timeline — rendered when the test was retried. Single attempt is
  // omitted since the headline `## Test Details` block already conveys it.
  if (failureDetails.attempts && failureDetails.attempts.length > 1) {
    const totalFailed = failureDetails.attempts.filter((a) => a.status !== 'passed').length;
    const finalAttempt = failureDetails.attempts[failureDetails.attempts.length - 1];
    const finalOutcome = finalAttempt.status === 'passed' ? 'eventually passed' : 'never recovered';
    block += `## Attempt History (${failureDetails.attempts.length} attempts, ${totalFailed} failed, ${finalOutcome})\n`;
    for (const a of failureDetails.attempts) {
      const dur = a.durationMs !== undefined ? ` ${a.durationMs}ms` : '';
      const summary = a.status === 'passed' ? '' : ` — ${summarizeAttemptMessage(a.message)}`;
      block += `- **Attempt ${a.attempt}** (${a.status}${dur})${summary}\n`;
    }
    block += '\n';
  }

  block += `## Error Message\n\`\`\`\n${failureDetails.message}\n\`\`\`\n\n`;

  if (failureDetails.stackTrace) {
    block += `## Stack Trace\n\`\`\`\n${failureDetails.stackTrace}\n\`\`\`\n\n`;
  }

  if (failureDetails.attachments && failureDetails.attachments.length > 0) {
    block += `## Attachments\n`;
    // Sort by name for deterministic output.
    const sorted = [...failureDetails.attachments].sort((a, b) => a.name.localeCompare(b.name));
    for (const att of sorted) {
      block += `- ${att.name} (${att.contentType})\n`;
    }
    block += '\n';
  }

  return block.trimEnd();
}

export interface CustomPromptOverrides {
  systemPrompt?: string;
  testAnalysisInstructions?: string;
  reportSummaryInstructions?: string;
  projectSummaryInstructions?: string;
  /** Failure category from the heuristic baseline — useful as a {{errorCategory}}
   *  binding when the user wants to bias the LLM toward / away from a baseline. */
  errorCategory?: string;
  /** Project name for binding in test/report/project instructions. */
  project?: string;
}

export const buildTestFailureSegments = (args: {
  systemPrompt?: string;
  failureDetails: FailureDetailsForPrompt;
  historicalContext?: {
    totalRuns?: number;
    recentFailureCount?: number;
    isFlaky?: boolean;
    previousCategories?: string[];
    isNewFailure?: boolean;
  };
  feedback?: { comment: string; updatedAt: string } | null;
  crossProjectEntries?: CrossProjectEntry[];
  crossProjectTotalCount?: number;
  overrides?: CustomPromptOverrides;
}): SegmentedPrompt => {
  const segments: PromptSegment[] = [];

  // System prompt: prefer override → arg → built-in default. The system prompt
  // doesn't accept mustache vars (no per-call data) so it stays templateOnly.
  segments.push({
    id: 'system_prompt',
    role: 'system',
    stable: true,
    templateOnly: true,
    content: args.overrides?.systemPrompt ?? getCustomSystemPrompt(args.systemPrompt),
  });

  segments.push({
    id: 'output_schema',
    role: 'system',
    stable: true,
    templateOnly: true,
    content: FAILURE_CATEGORY_SCHEMA,
  });

  // Task instructions: take the user's override if set, otherwise the built-in
  // default. BOTH contain {{var}} placeholders and BOTH go through the same
  // mustache substitution. Unifying the path means custom prompts render
  // identically to defaults — what users see in "View default" is exactly
  // what they'd write themselves to get the same result.
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
  // When substitution changed text, the rendered content varies per call —
  // not stable, not templateOnly. The pre-substitution template is preserved
  // separately on the segment so computePromptVersion still hashes the
  // template revision rather than the per-test data.
  const taskTemplateOnly = !taskSub.substituted;
  segments.push({
    id: 'task_instructions',
    role: 'user',
    stable: taskTemplateOnly,
    templateOnly: taskTemplateOnly,
    content: taskSub.rendered,
    template: taskSub.substituted ? taskInstructionsTemplate : undefined,
  });

  const history = buildHistoricalContextBlock(args.historicalContext);
  if (history) {
    segments.push({
      id: 'historical_context',
      role: 'user',
      stable: true,
      content: history,
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
  overrides?: CustomPromptOverrides;
}): SegmentedPrompt => {
  const segments: PromptSegment[] = [];

  segments.push({
    id: 'system_prompt',
    role: 'system',
    stable: true,
    templateOnly: true,
    content: args.overrides?.systemPrompt ?? getCustomSystemPrompt(args.systemPrompt),
  });

  const totalFailures = Object.values(args.categories).reduce((sum, c) => sum + c, 0);
  // Same unified path as test-analysis: default and override both go through
  // applyMustache; the pre-substitution template is preserved for versioning.
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
  const reportTemplateOnly = !reportSub.substituted;
  segments.push({
    id: 'task_instructions',
    role: 'user',
    stable: reportTemplateOnly,
    templateOnly: reportTemplateOnly,
    content: reportSub.rendered,
    template: reportSub.substituted ? reportInstructionsTemplate : undefined,
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
    dataBlock += `## Per-Test Analyses\n`;
    for (const analysis of args.perTestAnalyses.slice(0, 20)) {
      dataBlock += `- **${analysis.testTitle}** [${analysis.category}]: ${analysis.analysis.substring(0, 200)}\n`;
    }
    dataBlock += '\n';
  }

  segments.push({
    id: 'report_data',
    role: 'user',
    stable: false,
    content: dataBlock.trimEnd(),
  });

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
  overrides?: CustomPromptOverrides;
}): SegmentedPrompt => {
  const segments: PromptSegment[] = [];

  segments.push({
    id: 'system_prompt',
    role: 'system',
    stable: true,
    templateOnly: true,
    content: args.overrides?.systemPrompt ?? getCustomSystemPrompt(args.systemPrompt),
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
  const projectTemplateOnly = !projectSub.substituted;
  segments.push({
    id: 'task_instructions',
    role: 'user',
    stable: projectTemplateOnly,
    templateOnly: projectTemplateOnly,
    content: projectSub.rendered,
    template: projectSub.substituted ? projectInstructionsTemplate : undefined,
  });

  const latestRun = args.runs[0];
  const latestStatus = latestRun ? (runHasFailures(latestRun) ? 'FAILURES' : 'PASS') : 'unknown';

  let dataBlock = `Project: "${args.project}", latest ${totalRuns} runs.\n\n`;
  dataBlock += `**Overview:** ${passingRuns} of ${totalRuns} runs passed cleanly (no failures). ${runsWithFailures.length} runs had failures.\n`;
  dataBlock += `**Latest run status:** ${latestStatus}${latestRun ? ` (${latestRun.reportId})` : ''} — use this to anchor the verdict.\n\n`;
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

/** SHA-256-based version of the prompt template (no per-test data). Used to
 *  attribute each persisted analysis to the prompt template that produced it
 *  so prior analyses remain comparable across template revisions.
 *
 *  Hashes either `template` (the pre-substitution literal, preferred when
 *  set) or `content` (when the segment was static and templateOnly). This
 *  way the version reflects the template revision regardless of whether
 *  per-call data was substituted into placeholders. */
export function computePromptVersion(prompt: SegmentedPrompt): string {
  const hashable = prompt.segments
    .filter((s) => s.templateOnly || s.template)
    .map((s) => `${s.id}:${s.template ?? s.content}`)
    .join('|');
  return createHash('sha256').update(hashable).digest('hex').substring(0, 16);
}

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
// Priority order (least → most important to keep):
// 1. cross_project_context — additive, not load-bearing.
// 2. attachment list lines — drop names, keep count.
// 3. older entries in historical_context — keep recent failure stats only.
// 4. middle of current_failure — preserve head + tail (error top + stack tail).
// 5. user_feedback — dropped only as a last resort.
// 6. middle-truncate the whole rendered varying segments.

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

/** Drop the "Previous failure categories" line — least informative when budget tight. */
function shrinkHistoricalContext(content: string): string {
  return content.replace(/- Previous failure categories: .*\n/, '');
}

/**
 * Fit a SegmentedPrompt to `charsBudget` by applying shrink steps in priority
 * order until size <= budget or all steps are exhausted. Stable + templateOnly
 * segments (system_prompt, output_schema, task_instructions) are never touched
 * — they're the cacheable prefix and dropping them would defeat caching for
 * marginal char savings.
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
    tryStep('dropped cross-project context', (cur) => dropSegment(cur, 'cross_project_context'))
  ) {
    return { prompt: p, changes };
  }

  if (
    tryStep('omitted attachment names', (cur) =>
      transformSegment(cur, 'current_failure', shrinkAttachmentList)
    )
  ) {
    return { prompt: p, changes };
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

import type { ClusterEvidence, ClusterStrategy } from '@playwright-reports/shared';
import { FAILURE_CATEGORIES, formatDuration } from '@playwright-reports/shared';
import type { FailureEvidence } from '../../parser/failure-extraction.js';
import type { PerFileStep } from '../../parser/report-payload.js';
import type { PromptSegment, SegmentedPrompt } from '../types/index.js';

/** Comma-separated category enum, inlined into the test-analysis instructions
 *  so the model sees the same list the heuristic uses. */
const FAILURE_CATEGORY_LIST = FAILURE_CATEGORIES.join(', ');

/** Verdict enum mirrored in shared/types ReportAnalysisVerdict. Keep in sync. */
export const REPORT_VERDICT_ENUM = ['isolated', 'clustered', 'widespread', 'systemic'] as const;

/** Verdict enum mirrored in shared/types ProjectAnalysisVerdict. Keep in sync. */
export const PROJECT_VERDICT_ENUM = ['healthy', 'stabilizing', 'degrading', 'failing'] as const;

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
  'You are a Playwright test failure analyst. Use only the structured evidence below to explain what broke and why. Cite line numbers, file paths, error signatures, and response codes. Be direct and specific; avoid filler and generic testing advice.';
export const TEST_ANALYSIS_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT;
export const REPORT_SUMMARY_SYSTEM_PROMPT =
  'You are a test lead reviewing a single Playwright CI run. Group failures by root cause, using the fewest meaningful clusters. Prioritize fixes by how many tests each cluster would unblock, then by severity. Call out systemic patterns (shared fixtures, infra issues, repeated signatures) versus isolated bugs. Keep findings concrete: name specific files, fixtures, categories, and signatures. Avoid filler or generic testing advice.';
export const PROJECT_SUMMARY_SYSTEM_PROMPT =
  'You are a QA lead writing a brief health summary for a Playwright test project across its latest runs. Start with an overall verdict and a one-line headline. Base the verdict primarily on the most recent runs. Clearly separate transient flakes from persistent regressions. Do not restate per-run details the reader already sees in the UI; instead, synthesize patterns over runs. Be concrete about which tests, suites, or product areas regressed.';

export const TEST_ANALYSIS_TASK_INSTRUCTIONS = `
Test: {{testTitle}} (project "{{project}}", {{filePath}})
Heuristic category: {{errorCategory}}. Treat as a hypothesis; override only if evidence is strong.

Reply in plain Markdown. Use the exact section headings below. Sections 1 and 2 are required; section 3 is optional. Do not use JSON or code fences.

## Root Cause
Explain what broke. Ground every claim in concrete evidence: line numbers from Test Source / Step Tree / Stack, console errors, failed requests with status codes, attempt-history differences. Do not mention {{errorCategory}} here unless you later change it in the footer.

## What to Verify
List 2-3 specific checks to confirm or disprove the root cause. Each must be directly runnable (e.g., log query, env flag to toggle, code path to inspect, repro step). Avoid generic advice.

## Recommendation
Optional. Include only if you can name a clear fix (code edit, config change, infra action). Skip this section if the correct next step is “investigate further”. Short concrete code snippets are allowed.

After the sections, add at most one footer line, on its own line, with no heading or extra text:

Category: <one of: ${FAILURE_CATEGORY_LIST}>

If you agree with {{errorCategory}}, omit the Category line entirely.

Attempt-history rules:
- eventually passed -> transient or environmental; focus on retry/wait or instability diagnosis.
- same error on all attempts -> persistent defect; focus on code or state.
- different error per attempt -> state leakage between attempts; suspect fixtures or shared state.

The canonical Error block comes from the first failing attempt. Attempt History shows the full attempt timeline.
`;

export const REPORT_SUMMARY_TASK_INSTRUCTIONS = `
You analyze Playwright test failures.

## Task
Summarize failures for report \`{{reportId}}\` in project "{{project}}" ({{totalFailures}} failures). Focus on root causes via failure clusters.

## Data
- Failures are grouped into **clusters** by shared evidence:
  - strategy: 'signature', 'stack-frame', 'fixture', 'selector', 'temporal'
  - evidence: error signature, stack frame, fixture phase, timing
- Each cluster has tests with per-test root-cause analysis.
- Ungrouped failures appear as **Unclustered Failures**.
- Optional:
  - Run Context (branch, commit, CI build)
  - Trend (newly failed, still failing, fixed, duration changes)
  - Flaky Tests (passed on retry; NOT failures)

## Heuristics
- Large cluster ⇒ likely single root cause.
- 'fixture' clusters or converging clusters ⇒ systemic issue.
- Unclustered failures ⇒ likely isolated issues.

## Verdict (pick one)
- isolated: ≤2 failures, all unclustered
- clustered: 1-2 dominant clusters explain most failures
- widespread: many clusters, no dominant cause
- systemic: fixture-related OR several clusters share one root cause (prefer over 'clustered')

## Output (strict)
Return plain Markdown. No JSON. No code fences.

1. Line 1:
   **Verdict:** isolated|clustered|widespread|systemic

2. Blank line

3. Summary paragraph (1-3 sentences, no heading):
   - Restate verdict in plain English.
   - Call out the single most important cause or signal.

4. Sections (this order, include only if non-empty):

## Failure Patterns _(impact)_
- Describe dominant clusters and shared root causes.
- Name cluster strategy and evidence.
- Set impact in heading suffix:
  - largest blocking cluster: _(high impact)_
  - smaller clusters: _(medium impact)_ or _(low impact)_

## Recommendations
- Order items by impact; largest cluster first.
- When trend data exists, prioritize newly failed tests.
- Be concrete (files, fixtures, locators, infra).

## Risks (optional)
- Cross-cluster correlations.
- Suspicious unclustered failures.
- Flaky overlap or infra instability.

## Test links
- Test IDs are authoritative only when shown inline as:
  [testId: TEST_ID]
- For any linked test, copy 'title' and 'TEST_ID' from the same test line.
- IDs are opaque strings. Do not infer or rewrite them.
- Link format:
  [test title](pwrs:test/TEST_ID?project={{project}})
- If no inline 'testId' is present for a test mention, do not link it.

## Rules
- Do NOT repeat section headings in the body.
- Do NOT count flaky tests as failures.
- Mention flaky tests only if:
  - their signature overlaps a failure cluster, or
  - they suggest infra instability (put under Risks).
- Use per-test analyses as primary evidence.
- If Run Context exists, mention branch/commit/CI build.
- If trend data exists:
  - lead with newly failed tests (regressions),
  - reference trend summary when useful.
`;

export const PROJECT_SUMMARY_TASK_INSTRUCTIONS = `
Analyze test health for project "{{project}}" across the latest {{totalRuns}} runs ({{passingRuns}} clean).

Return plain Markdown only. No JSON. No code fences.

## Output
1. First line:
   **Verdict:** <healthy|stabilizing|degrading|failing>

2. Blank line

3. Executive summary (1-3 sentences, no heading):
   - Start with: "Project is <status>."
   - <status> must match the verdict exactly.
   - State the single most important supporting fact.

4. Then up to 4 sections, in this order, only if non-empty:

## Health Assessment
Explain the verdict. Distinguish persistent vs transient clusters. Call out new issues. Use recently resolved clusters as recovery evidence when relevant.

## Recommendations
Concrete actions for Active Failure Clusters only.

## Notable Trends
Use Trend Signal and run-window movement: pass rate, failures, duration, category drift, unusual runs, coverage changes, near-flakes.

## Risks
Optional. Extra concerns not covered above.

Do NOT repeat a section heading inside its body.

## Verdict rules
Choose exactly one:

- healthy:
  - no Active Failure Clusters, AND
  - latest runs are clean.
  - Also treat as healthy when the latest run is green and either:
    - all clusters are in Recently Resolved, or
    - any latest-run failures are flake/infra signals already covered by quarantine.
  - If a fix has held for ≥3 clean runs, use healthy, not stabilizing.

- stabilizing:
  - latest run is green, BUT
  - at least one cluster was active in the last 1-2 runs, OR
  - some clusters resolved while others still persist.
  - This means recovery is in progress but not yet proven.

- degrading:
  - at least one Active Failure Cluster is present in the latest run or last 1-2 runs, AND
  - retry recovery is low, OR
  - new persistent issues were introduced, OR
  - pass rate worsened meaningfully vs the prior window.

- failing:
  - many recent runs are red, including the latest, AND
  - multiple active signatures exist with no clear recovery.

Critical:
- A run with any unexpected or flaky tests is NOT a passing run.
- If the latest run has failures, do NOT call the project healthy.

## Cross-project aggregate
When the data says this is a cross-project aggregate:
- Treat each project as a separate area.
- Do NOT imply a cluster in one project affects another.
- Prefer per-project framing in the prose.
- Tie each recommendation to the project of the cited test.

## Links
Write links as real Markdown links, not backticked text.

Test link format:
[test title](pwrs:test/TEST_ID?project=PROJECT_NAME)
// example: pwrs:test/abcde12345-dcaega54321?project=main

Report link format:
[run #123](pwrs:report/REPORT_ID)
// example: pwrs:report/abcd-e123-45dc-aega

Test link rules:
- Canonical test IDs appear inline in entries such as:
  - (project=PROJECT_NAME; ...; testId=TEST_ID)
  - [testId: TEST_ID]
- For a linked test, copy the title, PROJECT_NAME, and TEST_ID from the same entry.
- Never mix a title from one entry with an ID from another.
- If the same title appears multiple times, use the ID from the exact entry you are discussing.
- If a test mention has no inline testId, do NOT link it; mention it in backticks instead.
- The visible label must be the human-readable test title, not a path or ID.
- IDs are opaque. Do NOT infer, normalize, shorten, or rewrite them.
- Use only IDs present in the supplied data.

Report link rules:
- REPORT_ID must come from the per-run dump.
- Do NOT invent or alter report IDs.

For non-clickable mentions (paths, signatures, fixture files), use backticks. There is no pwrs:file scheme.

## Cluster model
Active Failure Clusters are the primary input when present.

Cluster strategies:
- signature: same error signature -> likely one root cause.
- stack-frame: same top failing stack frame -> likely one code path.
- fixture: failure in beforeAll/beforeEach/afterAll/afterEach -> systemic; recommendations must be fixture-level, not per-test.
- temporal: tests co-failed in time -> weakest grouping; investigate shared infra before recommending per-test fixes.

Each cluster has an Evidence line. Name that evidence in prose, e.g. "the cluster sharing stack frame \`X\`" or "the cluster with signature \`Y\`".

Cluster buckets:
- Active Failure Clusters: present in the latest run or within the last 2 runs. Only these may appear in Recommendations.
- Recently Resolved Failure Clusters: last seen ≥3 runs ago. Use only as recovery evidence in Health Assessment. Never recommend fixes for resolved clusters.

If Active Failure Clusters is empty:
- Omit Recommendations entirely.
- Verdict must be healthy.
- Cite resolved clusters as evidence that recovery held.
- Do NOT use stabilizing here; stabilizing requires at least one cluster seen within the last 2 runs.

## Cluster classification
Use each Active Failure Cluster's Window and Retry recovery:

- in latest run AND recovery <50%:
  active regression. Lead Recommendations with these. Mention consecutive count when ≥2.

- in latest run AND recovery ≥50%:
  likely flake/infra. Recommend stabilization (retry tuning, fixture hardening, infra), not a product-code fix.

- last seen 1-2 runs ago:
  recently transient. Mention in Health Assessment. Include in Recommendations only if its evidence overlaps a currently active cluster.

- recovery 0% with ≥3 occurrences:
  call out explicitly as "never recovers".

When discussing fixture clusters:
- name the fixture file in backticks,
- link one affected test if helpful,
- do not frame the fix as a per-test change.

## Trend rules
Trend Signal is the numeric anchor for Notable Trends. Cite real deltas; do not eyeball trends from run lists.

Use the prior-window baseline and "Cluster flow vs prior window" together:

- high resolved, low new, latest run green:
  - healthy if all resolved clusters are ≥3 runs old,
  - stabilizing if any resolved cluster was last seen 1-2 runs ago.
  - In both cases, name the top resolved clusters in Health Assessment.

- high new, latest run red:
  - at least degrading.
  - Lead Recommendations with the new clusters.

- high persisting, low new/resolved:
  - the project is stuck; verdict follows current pass rate and latest-run state.

- no prior data:
  - fall back to per-cluster Window markers.
  - Do not claim a trend without a baseline.

- if "Last N vs prior N (in-window)" is skewed worse in the recent half:
  - treat that as a degrading signal even if overall pass rate looks flat.

Anchor the overall verdict primarily on the latest run and the most recent 1-2 runs.

## Additional signals
Suite:
- Interpret severity in context of suite size; "5 failures across 30 tests" is not the same as "5 across 3000".

Quarantine:
- Mention quarantine only if the Suite line includes a quarantined count.
- If quarantined tests exist, remind that they still need a real fix and should be un-quarantined after that.
- If "quarantined runs still failing in window" > 0, flag it in Risks.

Suite coverage:
- coverage delta ≤ -5% -> flag shrinkage in Notable Trends.
- strong positive coverage after a green window may indicate newly added coverage; mention when relevant.

Near-flakes (passed on retry):
- not failures,
- do not let them drive the verdict,
- mention them in Notable Trends for healthy verdicts,
- mention them in Risks when they overlap an active cluster.

Per-run Context lines:
- branch / commit / CI build may explain first appearance of a cluster.
- If a cluster first appears at a visible branch or commit boundary, mention that boundary.
- Do not speculate beyond the provided context.

## Recommendation rules
- Recommend actions only for Active Failure Clusters.
- Do not recommend fixes for resolved clusters.
- Prioritize by:
  1. largest unblock,
  2. latest-run presence,
  3. low retry recovery,
  4. persistence,
  5. severity.
- Be concrete: files, fixtures, wait conditions, locators, network expectations, infra actions.
- Avoid generic testing advice.

## No-failure window
If Active Failure Clusters are absent for the whole window:
- focus on Trend Signal, suite coverage, and near-flakes,
- keep Health Assessment to 1-2 sentences confirming no failures were observed and why the project still looks healthy.
`;

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
  projectSummarySystemPrompt?: string;
  testAnalysisInstructions?: string;
  projectSummaryInstructions?: string;
  /** Single override for the report-summary task. Replaces the task
   *  instructions template; the system message for this task is built-in
   *  and not user-overridable. */
  reportSummaryPrompt?: string;
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

  // --- Cacheable prefix: system + task instructions. ---
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

export type ReportSummaryClusterStrategy =
  | 'signature'
  | 'stack-frame'
  | 'fixture'
  | 'selector'
  | 'temporal';

/** Trend status of a failing test relative to the immediately previous report
 *  in the same project. `newlyFailed` = didn't fail in the previous report;
 *  `stillFailing` = also failed in the previous report; `unknown` = no
 *  previous report or no trend data available. */
export type ReportSummaryTrendStatus = 'newlyFailed' | 'stillFailing' | 'unknown';

export interface ReportSummaryClusterMember {
  testId: string;
  fileId: string;
  project: string;
  title: string;
  filePath?: string;
  /** True when this member failed in the report being summarized; false when
   *  the cluster includes a historical member who passed in this run. */
  inThisReport: boolean;
  /** Failure category from this report's run when available, otherwise from
   *  the attached per-test analysis, otherwise from the cluster itself. */
  category?: string;
  /** Failure message from this report's run. Empty for members who didn't
   *  fail in this run. NOT truncated. */
  message: string;
  /** Per-test LLM analysis. Empty when no analysis is attached yet. NOT truncated. */
  analysis: string;
  /** How many times this test appears in the cluster window. */
  occurrences: number;
  /** Trend tag computed from the prev-report diff. Only set when `inThisReport`
   *  is true; otherwise the trend doesn't apply. */
  trend?: ReportSummaryTrendStatus;
}

export interface ReportSummaryCluster {
  id: string;
  strategy: ReportSummaryClusterStrategy;
  name: string;
  category?: string;
  /** Representative error message for the cluster. NOT truncated. */
  sampleMessage: string;
  testCount: number;
  failureCount: number;
  evidence: {
    signature?: string;
    stackFrame?: string;
    fixturePhase?: string;
    coFailureRate?: number;
  };
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
  /** Failure message from this report's run. NOT truncated. */
  message: string;
  /** Per-test LLM analysis. Empty when no analysis is attached yet. NOT truncated. */
  analysis: string;
  /** Trend tag computed from the prev-report diff. */
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
  /** Error message from the failing attempt. NOT truncated. */
  message: string;
  /** Per-test LLM analysis (analyzed because the test failed at least once
   *  before retry passed). NOT truncated. */
  analysis: string;
}

export interface ReportSummaryRunContext {
  gitCommit?: {
    hash?: string;
    shortHash?: string;
    branch?: string;
    subject?: string;
  };
  ci?: {
    buildHref?: string;
    commitHref?: string;
    commitHash?: string;
  };
  playwrightVersion?: string;
  actualWorkers?: number;
  /** Report createdAt — ISO string. */
  createdAt?: string;
}

export const buildReportSummarySegments = (args: {
  systemPrompt?: string;
  reportId: string;
  categories: Record<string, number>;
  clusters: ReportSummaryCluster[];
  unclustered: ReportSummaryUnclusteredFailure[];
  flaky?: ReportSummaryFlakyTest[];
  runContext?: ReportSummaryRunContext;
  trendContext?: ReportSummaryTrendContext;
  overrides?: CustomPromptOverrides;
}): SegmentedPrompt => {
  const segments: PromptSegment[] = [];

  // The report-summary system message is now built-in — no per-task override.
  // The legacy `systemPrompt` fallback still applies for users who set the
  // catch-all `customSystemPrompt` to bias all three tasks.
  segments.push({
    id: 'system_prompt',
    role: 'system',
    stable: true,
    content: resolveSystemPrompt(
      REPORT_SUMMARY_SYSTEM_PROMPT,
      args.overrides?.systemPrompt ?? args.systemPrompt
    ),
  });

  const totalFailures = Object.values(args.categories).reduce((sum, c) => sum + c, 0);
  // Single user-overridable surface for this task.
  const reportInstructionsTemplate =
    args.overrides?.reportSummaryPrompt ?? REPORT_SUMMARY_TASK_INSTRUCTIONS;
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

  if (args.runContext) {
    const ctx = args.runContext;
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
    if (lines.length > 0) {
      segments.push({
        id: 'run_context',
        role: 'user',
        stable: false,
        content: `## Run Context\n${lines.join('\n')}\n`,
      });
    }
  }

  let dataBlock = `## Report: ${args.reportId}\n\n`;
  dataBlock += `## Failure Categories (${totalFailures} hard failures — excludes flaky tests, which are listed separately below)\n`;
  for (const [cat, count] of Object.entries(args.categories).sort((a, b) =>
    b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])
  )) {
    dataBlock += `- **${cat}**: ${count} failures\n`;
  }
  dataBlock += '\n';

  if (args.clusters.length > 0) {
    dataBlock += `## Failure Clusters (${args.clusters.length} clusters)\n`;
    dataBlock += `Clusters group failing tests by shared evidence. \`signature\` clusters share an error signature; \`stack-frame\` clusters share the topmost user-code stack frame; \`fixture\` clusters share a failing setup/teardown hook; \`temporal\` clusters failed together in the same run window. Member tests carry their own per-test root-cause analysis below.\n\n`;
    for (const cluster of args.clusters) {
      dataBlock += `### Cluster: ${cluster.name} [strategy: ${cluster.strategy}, id: ${cluster.id}]\n`;
      const factsParts: string[] = [];
      if (cluster.category) factsParts.push(`category: \`${cluster.category}\``);
      factsParts.push(`${cluster.testCount} tests`);
      factsParts.push(`${cluster.failureCount} failures (window)`);
      if (typeof cluster.evidence.coFailureRate === 'number') {
        factsParts.push(`co-failure rate: ${(cluster.evidence.coFailureRate * 100).toFixed(0)}%`);
      }
      dataBlock += `- ${factsParts.join(' · ')}\n`;
      const evParts: string[] = [];
      if (cluster.evidence.signature) evParts.push(`signature \`${cluster.evidence.signature}\``);
      if (cluster.evidence.stackFrame)
        evParts.push(`stack frame \`${cluster.evidence.stackFrame}\``);
      if (cluster.evidence.fixturePhase)
        evParts.push(`fixture phase \`${cluster.evidence.fixturePhase}\``);
      if (evParts.length > 0) {
        dataBlock += `- Evidence: ${evParts.join(' · ')}\n`;
      }
      if (cluster.sampleMessage) {
        dataBlock += `- Sample error:\n\`\`\`\n${cluster.sampleMessage}\n\`\`\`\n`;
      }
      const membersInRun = cluster.members.filter((m) => m.inThisReport);
      const membersHistorical = cluster.members.filter((m) => !m.inThisReport);
      dataBlock += `\n#### Members in this report (${membersInRun.length})\n`;
      if (membersInRun.length === 0) {
        dataBlock += `_None of this cluster's tests failed in this report._\n`;
      }
      for (const m of membersInRun) {
        const fileSuffix = m.filePath ? ` (${m.filePath})` : '';
        const catLabel = m.category ? ` [${m.category}]` : '';
        const trendLabel = renderTrendLabel(m.trend);
        dataBlock += `- **${m.title}** [testId: ${m.testId}]${catLabel}${fileSuffix}${trendLabel}\n`;
        if (m.message) {
          const indentedMessage = m.message.replace(/\n/g, '\n    ');
          dataBlock += `    Error: ${indentedMessage}\n`;
        }
        if (m.analysis) {
          const rootCause = extractRootCauseParagraph(m.analysis);
          const indented = rootCause.replace(/\n/g, '\n    ');
          dataBlock += `    Per-test analysis:\n    ${indented}\n`;
        }
      }
      if (membersHistorical.length > 0) {
        dataBlock += `\n#### Historical members (${membersHistorical.length}) — failed in this cluster's window but not in this report\n`;
        for (const m of membersHistorical) {
          const fileSuffix = m.filePath ? ` (${m.filePath})` : '';
          dataBlock += `- ${m.title} [testId: ${m.testId}]${fileSuffix} (${m.occurrences} occurrences)\n`;
        }
      }
      dataBlock += '\n';
    }
  }

  if (args.unclustered.length > 0) {
    dataBlock += `## Unclustered Failures (${args.unclustered.length})\n`;
    dataBlock += `Failures in this report that didn't group into any multi-test cluster. Each carries its per-test analysis.\n\n`;
    for (const f of args.unclustered) {
      const fileSuffix = f.filePath ? ` (${f.filePath})` : '';
      const trendLabel = renderTrendLabel(f.trend);
      dataBlock += `### ${f.title} [testId: ${f.testId}] [${f.category}]${fileSuffix}${trendLabel}\n`;
      if (f.errorSignature) {
        dataBlock += `- Signature: \`${f.errorSignature}\`\n`;
      }
      if (f.message) {
        dataBlock += `- Error:\n\`\`\`\n${f.message}\n\`\`\`\n`;
      }
      if (f.analysis) {
        const rootCause = extractRootCauseParagraph(f.analysis);
        const indented = rootCause.replace(/\n/g, '\n  ');
        dataBlock += `- Per-test analysis:\n  ${indented}\n`;
      }
      dataBlock += '\n';
    }
  }

  if (args.flaky && args.flaky.length > 0) {
    dataBlock += `## Flaky Tests (${args.flaky.length})\n`;
    dataBlock += `These tests failed at least once but eventually passed on retry. **They are NOT failures.** Do NOT include them in the failure count, do NOT let them drive the verdict. Mention them only as observations (e.g., "X test flaked — worth watching") if they share a signature with a real cluster or look systemic.\n\n`;
    for (const f of args.flaky) {
      const fileSuffix = f.filePath ? ` (${f.filePath})` : '';
      dataBlock += `### ${f.title} [testId: ${f.testId}] [${f.category}]${fileSuffix}\n`;
      if (f.errorSignature) {
        dataBlock += `- Signature: \`${f.errorSignature}\`\n`;
      }
      if (f.message) {
        dataBlock += `- Error (from the failing attempt):\n\`\`\`\n${f.message}\n\`\`\`\n`;
      }
      if (f.analysis) {
        const rootCause = extractRootCauseParagraph(f.analysis);
        const indented = rootCause.replace(/\n/g, '\n  ');
        dataBlock += `- Per-test analysis:\n  ${indented}\n`;
      }
      dataBlock += '\n';
    }
  }

  segments.push({
    id: 'report_data',
    role: 'user',
    stable: false,
    content: dataBlock.trimEnd(),
  });

  if (args.trendContext) {
    // The trend renderer's insight computer needs a flat (testTitle, category,
    // analysis) list to look up "which category dominates the newly-failed
    // set." Flatten cluster members + unclustered failures back into that
    // shape for compatibility — only members that failed in this report.
    const perTestForTrend: Array<{ testTitle: string; category: string; analysis: string }> = [];
    for (const c of args.clusters) {
      for (const m of c.members) {
        if (!m.inThisReport) continue;
        perTestForTrend.push({
          testTitle: m.title,
          category: m.category ?? c.category ?? 'unknown',
          analysis: m.analysis,
        });
      }
    }
    for (const f of args.unclustered) {
      perTestForTrend.push({
        testTitle: f.title,
        category: f.category,
        analysis: f.analysis,
      });
    }
    segments.push({
      id: 'trend_context',
      role: 'user',
      stable: false,
      content: renderReportTrendContext(args.trendContext, perTestForTrend),
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

/** First two path segments, e.g. `tests/auth/login.spec.ts` -> `tests/auth`.
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

/** Render a small inline trend tag for a failing test entry. Returns an
 *  empty string when the trend is undefined or `unknown` so entries without
 *  comparable history don't get a misleading label. */
function renderTrendLabel(trend: ReportSummaryTrendStatus | undefined): string {
  if (trend === 'newlyFailed') return ' — **newly failed since previous report**';
  if (trend === 'stillFailing') return ' — still failing from previous report';
  return '';
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
        `- ${d.title} (${d.filePath}): ${formatMs(d.durationA)} -> ${formatMs(d.durationB)} (${sign}${(d.deltaPct * 100).toFixed(0)}%)`
      );
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
};

/** Aggregated failure cluster across the project's latest runs. Built by the
 *  queue worker via the shared `getFailureClusters` engine, then enriched
 *  with project-level lifecycle data (first/last seen, retry recovery).
 *
 *  A cluster groups failing tests by one of four strategies:
 *  - `signature` — same error signature
 *  - `stack-frame` — share a stack frame (likely same code path, different msg)
 *  - `fixture` — fixture / setup-teardown failure (systemic, often spans tests)
 *  - `temporal` — co-failed in time (suspicious correlation)
 *  The strategy plus evidence shape lets the model frame "5 unrelated tests
 *  share a beforeEach failure" differently from "5 separate timeouts." */
export interface ProjectCluster {
  /** Stable cross-window identity, derived from strategy + primary evidence.
   *  Used by the trend signal to detect resolved/persisting/new clusters. */
  stableKey: string;
  strategy: ClusterStrategy;
  evidence: ClusterEvidence;
  /** Most common per-test failure category for tests in the cluster, or 'unknown'. */
  category: string;
  /** Total failing test_runs across all cluster members within the window. */
  occurrences: number;
  /** Distinct reports in the window where at least one cluster member failed. */
  reportsAffected: number;
  affectedTests: Array<{
    testId: string;
    fileId: string;
    title: string;
    filePath: string;
    project: string;
  }>;
  sampleMessage: string;
  /** Most recent per-test LLM root-cause paragraph for a representative member,
   *  surfaced so the project verdict can echo a known root cause without
   *  rerunning per-test analysis. */
  latestRootCause?: string;
  /** Oldest run (within the window) where any cluster member failed. */
  firstSeenReportId: string;
  firstSeenAt: string;
  firstSeenDisplayNumber?: number;
  /** Most recent run (within the window) where any cluster member failed. */
  lastSeenReportId: string;
  lastSeenAt: string;
  lastSeenDisplayNumber?: number;
  /** True when the cluster has any failing member in the latest run. */
  appearedInLatestRun: boolean;
  consecutiveLatestRuns: number;
  runsSinceLastSeen: number;
  /** Cluster-wide `flaky` outcomes (ultimately passed on retry). */
  flakyOccurrences: number;
  /** `flakyOccurrences / occurrences` — 0..1. */
  retryRecoveryRate: number;
}

/** Per-window aggregate metrics used by the trend signal block. */
export interface ProjectTrendWindow {
  runs: number;
  /** Runs with no failures (unexpected + flaky == 0). */
  passingRuns: number;
  passRatePct: number;
  flakyCount: number;
  /** Total failed test occurrences (unexpected + flaky) summed across runs. */
  failureCount: number;
  /** Average per-run duration in milliseconds. */
  avgRunDurationMs: number;
}

/** Cross-window classification of failure clusters: which prior-window
 *  clusters are still present this window, which were resolved, and
 *  which are new this window. Identity is the cluster's `stableKey`
 *  (strategy + primary evidence). */
export interface ClusterFlow {
  resolvedCount: number;
  persistingCount: number;
  newCount: number;
  /** Top resolved clusters (by occurrence in the prior window). Names them
   *  so the model can cite "X is no longer firing" in the recovery framing. */
  topResolved: Array<{
    strategy: ClusterStrategy;
    category: string;
    reportsAffected: number;
    sampleTest?: string;
  }>;
}

/** Top "near-flake" — a test that passed on retry inside the window. Carries
 *  enough metadata to populate a navigable codeRef. */
export interface ProjectNearFlake {
  testId: string;
  fileId: string;
  title: string;
  filePath: string;
  flakyOccurrences: number;
}

/** Suite-scope / quarantine summary for the project. Lets the model frame
 *  "5 failures" relative to suite size and surface quarantine churn. */
export interface ProjectCoverageScope {
  /** Distinct tests currently in scope for the project. */
  totalTests: number;
  /** Tests whose `tests.createdAt` falls within the analyzed window. */
  testsAddedInWindow: number;
  /** Distinct tests whose latest test_run is quarantined. */
  currentlyQuarantined: number;
  /** Test_runs in the window's reports that were marked quarantined AND
   *  failed anyway (outcome unexpected or flaky). High value here means
   *  the quarantine isn't actually silencing the issue. */
  quarantineFailuresInWindow: number;
  /** Distinct tests with at least one run in the current window. */
  windowDistinctTests: number;
  /** Distinct tests with at least one run in the prior window. Undefined
   *  when no prior window is available. Used by the model to flag suite
   *  shrinkage. */
  priorDistinctTests?: number;
  /** Top tests that had at least one `flaky` outcome (passed on retry) in
   *  the current window. Capped at 5; ordered by occurrence count. */
  nearFlakes: ProjectNearFlake[];
}

/** Trend signal computed locally by the queue worker. All fields are
 *  optional — the prompt skips the block when the project has too few
 *  reports to build it. The `current` window is the same set the verdict
 *  is generated against; `prior` is the equivalent block immediately
 *  preceding; `splits` is the in-window last-half-vs-first-half split
 *  (only emitted when the current window has ≥4 runs). */
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

/** Format a signed delta with sign + one decimal; `+0.0` and `-0.0` collapse
 *  to `0.0` so the line reads cleanly when nothing changed. */
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

/** "#42 (abc1234, …)" when displayNumber is known, else just the reportId.
 *  Used for the run-dump header where readers want both forms to cross-
 *  reference. The slimmer `formatRunRef` variant below is used in dense
 *  in-line citations (root-cause Window lines) where the raw reportId is
 *  noise. */
function formatRunLabel(reportId: string, displayNumber?: number): string {
  return typeof displayNumber === 'number' ? `#${displayNumber} (${reportId})` : reportId;
}

/** "#42" when displayNumber is known, else the reportId. For dense in-line
 *  citations where the raw reportId is just visual noise. */
function formatRunRef(reportId: string, displayNumber?: number): string {
  return typeof displayNumber === 'number' ? `#${displayNumber}` : reportId;
}

/** ISO timestamp -> `YYYY-MM-DD` for the calendar-only views. */
function isoDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Number of full days between two ISO dates. Used for the window-duration
 *  header so the model knows whether "10 runs" means 1 day of CI or 2 months. */
function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  return Math.max(1, Math.round((to - from) / 86_400_000));
}

/** Compact evidence line per cluster. The clustering engine guarantees at
 *  least one piece of evidence per cluster — we surface them by precedence
 *  (signature > stackFrame > fixturePhase > coFailureRate) so the model can
 *  reason about the cluster's grouping basis. */
function renderClusterEvidenceInline(
  strategy: ClusterStrategy,
  evidence: ClusterEvidence
): string | null {
  const parts: string[] = [`strategy=${strategy}`];
  if (evidence.signature) parts.push(`signature=\`${evidence.signature}\``);
  if (evidence.stackFrame) parts.push(`stack frame=\`${evidence.stackFrame}\``);
  if (evidence.fixturePhase) parts.push(`fixture phase=\`${evidence.fixturePhase}\``);
  if (typeof evidence.coFailureRate === 'number') {
    parts.push(`co-failure rate=${(evidence.coFailureRate * 100).toFixed(0)}%`);
  }
  if (evidence.secondaryEvidence && evidence.secondaryEvidence.length > 0) {
    const sec = evidence.secondaryEvidence.map((s) => `${s.strategy}×${s.count}`).join(', ');
    parts.push(`also matched: ${sec}`);
  }
  return parts.join(' · ');
}

/** Compact one-line context for the per-run dump. Only fields with non-empty
 *  values appear; returns null when nothing was set. */
function renderRunContextInline(ctx: ReportSummaryRunContext): string | null {
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
  // `Total failures` = unexpected + flaky. The model can read the per-run
  // dump for the unexpected-vs-flaky split when it matters; collapsing to
  // one delta removes the redundancy with a separate flaky-only line.
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

  // Explicit prior-window baseline: "X of N passed cleanly" mirrors the
  // overview line for the current window so the model can frame "stabilizing"
  // vs "degrading" against a concrete number, not a slope it has to estimate.
  if (prior) {
    block += `- **Prior ${prior.runs} runs:** ${prior.passingRuns} of ${prior.runs} passed cleanly · pass rate ${prior.passRatePct.toFixed(1)}% · ${prior.failureCount} failures\n`;
  }

  // Cluster flow across the window boundary. "Resolved" is the strongest
  // recovery evidence; "new" hints at fresh regressions even when overall
  // pass rate looks fine.
  if (clusterFlow) {
    block += `- **Cluster flow vs prior window:** ${clusterFlow.resolvedCount} resolved · ${clusterFlow.persistingCount} persisting · ${clusterFlow.newCount} new\n`;
    if (clusterFlow.topResolved.length > 0) {
      const resolvedList = clusterFlow.topResolved
        .map((r) =>
          r.sampleTest
            ? `\`${r.strategy}\`/\`${r.category}\` (was in ${r.reportsAffected} prior runs, e.g. \`${r.sampleTest}\`)`
            : `\`${r.strategy}\`/\`${r.category}\` (was in ${r.reportsAffected} prior runs)`
        )
        .join('; ');
      block += `- **Top resolved:** ${resolvedList}\n`;
    }
  }

  block += '\n';
  return block;
}

export const buildProjectSummarySegments = (args: {
  systemPrompt?: string;
  project: string;
  runs: Array<{
    reportId: string;
    /** Optional human-friendly run number — `#42` reads better in prose than
     *  a raw reportId. Falls back to a truncated reportId when absent. */
    displayNumber?: number;
    createdAt: string;
    stats: { total: number; expected: number; unexpected: number; flaky: number; skipped: number };
    totalFailures: number;
    categories: Record<string, number>;
    llmSummary?: string;
    /** Per-run git/CI/env context. Rendered as a compact one-liner inside the
     *  run dump so the model can correlate signature onset with a branch /
     *  commit / build. */
    runContext?: ReportSummaryRunContext;
  }>;
  clusters?: ProjectCluster[];
  trendSignal?: ProjectTrendSignal;
  coverage?: ProjectCoverageScope;
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
  // Cross-project aggregate ("all")
  if (args.project === 'all' && args.clusters && args.clusters.length > 0) {
    const distinctProjects = new Set<string>();
    for (const c of args.clusters) {
      for (const t of c.affectedTests) distinctProjects.add(t.project);
    }
    if (distinctProjects.size > 1) {
      const list = Array.from(distinctProjects)
        .sort()
        .map((p) => `\`${p}\``)
        .join(', ');
      dataBlock += `**Cross-project aggregate:** this window spans ${distinctProjects.size} distinct projects (${list}). Each project represents a separate area or test suite — a failure cluster in one project does NOT imply the same regression in another. When summarizing health, prefer per-project framing ("X is degrading, Y is healthy") over a single blended verdict; tie recommendations to the specific project of each cited test.\n\n`;
    }
  }
  // Window-duration line: makes the calendar span explicit so the model
  // doesn't conflate "10 runs over 2 months" with "10 runs in one day."
  const oldestRun = args.runs[totalRuns - 1];
  if (latestRun && oldestRun) {
    const days = daysBetweenIso(oldestRun.createdAt, latestRun.createdAt);
    const oldestDay = oldestRun.createdAt.slice(0, 10);
    const latestDay = latestRun.createdAt.slice(0, 10);
    dataBlock += `**Window:** ${oldestDay} -> ${latestDay} (${days} day${days === 1 ? '' : 's'}, ${totalRuns} run${totalRuns === 1 ? '' : 's'})\n`;
  }
  dataBlock += `**Overview:** ${passingRuns} of ${totalRuns} runs passed cleanly (no failures). ${runsWithFailures.length} runs had failures.\n`;
  // Coverage scope: lets the model interpret "N failures" relative to suite
  // size, and surface quarantine churn that wouldn't otherwise reach the
  // verdict (quarantined-but-still-failing tests don't appear in the per-run
  // category histograms).
  if (args.coverage) {
    const c = args.coverage;
    const addedPart = c.testsAddedInWindow > 0 ? ` · ${c.testsAddedInWindow} added in window` : '';
    const quarantinePart =
      c.currentlyQuarantined > 0
        ? ` · ${c.currentlyQuarantined} quarantined${c.quarantineFailuresInWindow > 0 ? ` (${c.quarantineFailuresInWindow} quarantined runs still failing in window)` : ''}`
        : '';
    dataBlock += `**Suite:** ${c.totalTests} tests${addedPart}${quarantinePart}\n`;
    // Suite shrinkage signal: count of distinct tests touched by the current
    // window vs the prior window. Surface as a delta so the model can flag a
    // shrinking suite even when overall pass rate looks fine.
    if (typeof c.priorDistinctTests === 'number') {
      const delta = c.windowDistinctTests - c.priorDistinctTests;
      const deltaLabel = delta === 0 ? '0' : delta > 0 ? `+${delta}` : String(delta);
      dataBlock += `**Suite coverage:** ${c.windowDistinctTests} distinct tests ran this window (Δ ${deltaLabel} vs prior window's ${c.priorDistinctTests})\n`;
    }
    // Near-flakes: tests that passed on retry in the window. Tracked separately
    // from root causes because they're not failures, but they signal infra
    // instability that a "healthy" verdict should still mention.
    if (c.nearFlakes.length > 0) {
      const list = c.nearFlakes
        .map(
          (nf) => `\`${nf.title}\` (${nf.filePath}; testId=${nf.testId}) — ${nf.flakyOccurrences}×`
        )
        .join('; ');
      dataBlock += `**Near-flakes (passed on retry):** ${list}\n`;
    }
  }
  dataBlock += `**Latest run status:** ${latestStatus}${latestRun ? ` (${formatRunLabel(latestRun.reportId, latestRun.displayNumber)})` : ''} — use this to anchor the verdict.\n\n`;

  // Split clusters by lifecycle so the model can't accidentally recommend
  // fixes for issues that are already resolved. A cluster is "active" if any
  // member failed in the latest run OR within the past 2 runs. Otherwise it's
  // "resolved" — informational only, never an action target.
  const isActiveCluster = (c: ProjectCluster): boolean =>
    c.appearedInLatestRun || c.runsSinceLastSeen <= 2;
  const activeClusters = (args.clusters ?? []).filter(isActiveCluster);
  const resolvedClusters = (args.clusters ?? []).filter((c) => !isActiveCluster(c));

  if (activeClusters.length > 0) {
    dataBlock += `## Active Failure Clusters (present in latest run or within last 2 runs — drive Recommendations)\n`;
    for (let i = 0; i < activeClusters.length; i++) {
      const c = activeClusters[i];
      const evidenceLine = renderClusterEvidenceInline(c.strategy, c.evidence);
      dataBlock += `\n### ${i + 1}. \`${c.strategy}\` cluster — \`${c.category}\` — ${c.occurrences}× across ${c.reportsAffected} run${c.reportsAffected === 1 ? '' : 's'} (${c.affectedTests.length} test${c.affectedTests.length === 1 ? '' : 's'})\n`;
      if (evidenceLine) {
        dataBlock += `- **Evidence:** ${evidenceLine}\n`;
      }
      const sample = c.sampleMessage.replace(/\s+/g, ' ').trim();
      const sampleTrunc = sample.length > 300 ? `${sample.substring(0, 300)}…` : sample;
      if (sampleTrunc) {
        dataBlock += `- **Sample error:** \`${sampleTrunc}\`\n`;
      }
      const testsList = c.affectedTests
        .slice(0, 3)
        .map((t) => `\`${t.title}\` (project=${t.project}; ${t.filePath}; testId=${t.testId})`)
        .join(', ');
      const more = c.affectedTests.length > 3 ? ` +${c.affectedTests.length - 3} more` : '';
      dataBlock += `- **Affected tests:** ${testsList}${more}\n`;
      const latestMarker = c.appearedInLatestRun
        ? `**in latest run** (${c.consecutiveLatestRuns} consecutive)`
        : `last seen ${c.runsSinceLastSeen} run${c.runsSinceLastSeen === 1 ? '' : 's'} ago`;
      const firstSeenRef = formatRunRef(c.firstSeenReportId, c.firstSeenDisplayNumber);
      const lastSeenRef = formatRunRef(c.lastSeenReportId, c.lastSeenDisplayNumber);
      dataBlock += `- **Window:** first seen ${firstSeenRef} (${isoDate(c.firstSeenAt)}) -> last seen ${lastSeenRef} (${isoDate(c.lastSeenAt)}); ${latestMarker}\n`;
      if (c.occurrences > 0) {
        const pct = Math.round(c.retryRecoveryRate * 100);
        dataBlock += `- **Retry recovery:** ${pct}% (${c.flakyOccurrences} of ${c.occurrences} occurrences ultimately passed on retry)\n`;
      }
      if (c.latestRootCause) {
        const indented = c.latestRootCause.replace(/\n/g, '\n  ');
        dataBlock += `- **Prior LLM root cause:**\n  ${indented}\n`;
      }
    }
    dataBlock += '\n';
  }

  // Resolved clusters: compact list — enough for the model to cite
  // "stabilized after the X cluster cleared" in Health Assessment, but not
  // enough detail to invite a Recommendations bullet.
  if (resolvedClusters.length > 0) {
    dataBlock += `## Recently Resolved Failure Clusters (NOT for Recommendations — cite only as recovery evidence in Health Assessment)\n`;
    for (const c of resolvedClusters) {
      const lastSeenRef = formatRunRef(c.lastSeenReportId, c.lastSeenDisplayNumber);
      const titles = c.affectedTests
        .slice(0, 2)
        .map((t) => `\`${t.title}\``)
        .join(', ');
      const more = c.affectedTests.length > 2 ? ` +${c.affectedTests.length - 2} more` : '';
      dataBlock += `- \`${c.strategy}\`/\`${c.category}\` — ${c.occurrences}× across ${c.reportsAffected} run${c.reportsAffected === 1 ? '' : 's'}; last seen ${lastSeenRef} (${c.runsSinceLastSeen} runs ago); tests: ${titles}${more}\n`;
    }
    dataBlock += '\n';
  }

  // Trend signal: pass rate / flaky / duration deltas vs the prior window, plus
  // the in-window last-half-vs-first-half failure split. Pre-computed so the
  // verdict can be anchored on numbers rather than the model eyeballing the
  // per-run dump for a slope.
  if (args.trendSignal) {
    dataBlock += renderTrendSignal(args.trendSignal);
  }

  dataBlock += `Runs are listed from most recent to oldest:\n\n`;

  for (const run of args.runs) {
    const status = runHasFailures(run) ? 'FAILURES' : 'PASS';
    const runLabel = formatRunLabel(run.reportId, run.displayNumber);
    dataBlock += `### Run ${runLabel} (${run.createdAt}) — ${status}\n`;
    dataBlock += `- Tests: ${run.stats.total} total, ${run.stats.expected} passed, ${run.stats.unexpected} failed, ${run.stats.flaky} flaky, ${run.stats.skipped} skipped\n`;
    if (run.runContext) {
      const ctxLine = renderRunContextInline(run.runContext);
      if (ctxLine) dataBlock += `- Context: ${ctxLine}\n`;
    }
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
 * The pattern matches 1+ leading backslashes so multi-level over-escaping
 * is collapsed in a single pass. Detect-and-unescape only when at
 * least one such sequence is present, so legitimate text is left alone.
 */
export function unescapeLiteralNewlines(text: string): string {
  if (!text || !/\\+[ntr"]/.test(text)) return text;
  return text
    .replace(/\\+n/g, '\n')
    .replace(/\\+t/g, '\t')
    .replace(/\\+r/g, '\r')
    .replace(/\\+"/g, '"');
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

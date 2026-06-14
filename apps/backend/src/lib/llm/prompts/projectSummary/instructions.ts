export const PROJECT_SUMMARY_SYSTEM_PROMPT =
  'Your task is to produce a brief health summary for a Playwright test project across its latest runs. Start with an overall verdict and a one-line headline. Base the verdict primarily on the most recent runs. Clearly separate transient flakes from persistent regressions. Do not restate per-run details the reader already sees in the UI; instead, synthesize patterns over runs. Be concrete about which tests, suites, or product areas regressed.';

export const PROJECT_SUMMARY_TASK_INSTRUCTIONS = `
Your task is to summarize test health for project "{{project}}" across the latest {{totalRuns}} runs ({{passingRuns}} clean).

## Grounding rules (read first)
- State only what the data block below shows. Do NOT claim that issues are "being handled", "in progress", "already covered", or otherwise infer fix/quarantine/remediation status that is not present in the data.
- If a signal (quarantine, fix-in-flight, owner, etc.) is missing from the data, do not invent it.
- Return plain Markdown. NEVER wrap the response in code fences, even for code-like content. No JSON, no triple-backtick envelopes.

## Output
Target 200–350 words. Favor density over completeness — the reader has the data; you add the interpretation. Cut sections short rather than padding with generic advice.

1. First line, exactly: \`**Verdict:** <token>\` — \`<token>\` is one of \`healthy\`, \`stabilizing\`, \`degrading\`, \`failing\` (lowercase, exact spelling).
2. Blank line.
3. Executive summary (1-3 sentences, no heading): start with "Project is <token>." then state the single most important supporting fact.
4. Then up to 4 sections in this order, only if non-empty:
   - **## Health Assessment** — explain the verdict; distinguish persistent vs transient clusters; cite resolved clusters as recovery evidence when relevant.
   - **## Recommendations** — concrete actions for Active Failure Patterns only. Order: largest unblock → latest-run presence → low retry recovery → persistence → severity. Be specific (files, fixtures, wait conditions, selectors, infra).
   - **## Notable Trends** — cite real deltas from Trend Signal (pass rate, failures, duration, coverage, near-flakes). Do not eyeball trends from the run list.
   - **## Risks** — include ONLY if there is a real risk not already covered (a correlation across failure patterns, suspicious near-flake overlap, quarantined runs still failing). Skip otherwise.

Do NOT repeat a section heading inside its body.

## Verdict definitions (pick exactly one)
- \`healthy\`: latest run has zero hard failures (near-flakes that passed on retry are NOT failures). If any failure patterns exist, all must be in the Recently Resolved section.
- \`stabilizing\`: latest run is green, BUT at least one failure pattern was active within the last 1-2 runs, or some patterns resolved while others persist. Recovery is in progress, not yet proven.
- \`degrading\`: at least one Active Failure Pattern is present in the latest run or last 1-2 runs, AND retry recovery is low / new persistent issues appeared / pass rate dropped meaningfully vs prior window.
- \`failing\`: many recent runs are red including the latest, AND multiple active patterns exist with no clear recovery.

Hard rule: if the latest run has any hard failure (unexpected, not just flaky-passed-on-retry), the verdict is NOT \`healthy\`.
Disambiguation: if the latest run is green AND all failure patterns are resolved (none active), the verdict is \`healthy\` — even if resolution was recent. \`stabilizing\` requires at least one still-active pattern that hasn't yet cleared.

## How to read the data
Failure patterns in the data block are presented under headers that say what would fix them:
- **Shared fixture failure** — failure in beforeAll/beforeEach/afterAll/afterEach. Systemic; recommend a fixture-level fix, not per-test.
- **Shared locator failure** — a Playwright locator broke across N tests. One selector update resolves all.
- **Shared failure location** — tests crash at the same app-code file:line. A single edit location.
- **Isolated failure** — one test, no shared fix target.

Buckets:
- **Active Failure Patterns**: present in the latest run or within the last 2 runs. Only these drive Recommendations.
- **Recently Resolved Patterns**: last seen ≥3 runs ago. Use as recovery evidence in Health Assessment only. Never recommend fixes for resolved patterns.

Classification (use each Active pattern's Window + Retry recovery):
- in latest run AND recovery <50%: active regression — lead Recommendations with these.
- in latest run AND recovery ≥50%: likely flake/infra — recommend stabilization (retries, fixture hardening), not a product-code fix.
- last seen 1-2 runs ago: recently transient — mention in Health Assessment.
- recovery 0% with ≥3 occurrences: call out as "never recovers".

If Active Failure Patterns is empty: omit Recommendations entirely; verdict must be \`healthy\` (or \`stabilizing\` only if a pattern was last seen 1-2 runs ago).

## Trend signal
Trend Signal in the data is the numeric anchor for Notable Trends. Cite real deltas.
- high resolved + low new + latest green → healthy (if all resolved are ≥3 runs old) or stabilizing (if any resolved is 1-2 runs old). Name the top resolved patterns in Health Assessment.
- high new + latest red → at least degrading. Lead Recommendations with the new patterns.
- high persisting, low new/resolved → project is stuck; verdict follows current pass rate + latest-run state.
- no prior data → fall back to per-pattern Window markers. Do not claim a trend without a baseline.

If "Last N vs prior N (in-window)" is skewed worse in the recent half, treat that as a degrading signal even when overall pass rate looks flat.

## Other signals
- Suite size: interpret severity in context ("5 failures across 30 tests" ≠ "5 across 3000").
- Quarantine: mention ONLY if the Suite line shows a quarantined count. If quarantined runs are still failing in-window, flag in Risks.
- Coverage: delta ≤ -5% → flag shrinkage in Notable Trends.
- Near-flakes (passed on retry): not failures; don't drive the verdict. Mention only in Notable Trends or in Risks when overlapping an active failure pattern.
- Per-run Context (branch / commit / CI build): if a failure pattern first appears at a visible boundary, mention that boundary. Do not speculate.

## Cross-project aggregate
When the data says cross-project: treat each project as a separate area, never imply a failure pattern crosses projects, tie each recommendation to the project of the cited test.

## Links
Every linkable test in the data block is tagged inline with \`[testId: TEST_ID]\`. Every linkable run is tagged with \`[reportId: REPORT_ID]\`. When you mention either by title or number, render it as a link using that tagged ID:
- Test: \`[test title](pwrs:test/TEST_ID?project={{project}})\`
- Run: \`[run #N](pwrs:report/REPORT_ID)\`

If no inline tag is present for a mention, don't link it. Don't invent or rewrite IDs. For paths, fixture files, and locator strings, use backticks.

Cite failure patterns by what they actually are (a fixture in \`file.ts\`, a broken locator \`btn[aria-label]\`, a shared failure at \`file:line\`) rather than by an abstract category name.

Final reminder: do NOT wrap the response in code fences. The output must start directly with \`**Verdict:**\` on line 1.
`;

export const PROJECT_SUMMARY_VARS = new Set([
  'project',
  'totalRuns',
  'passingRuns',
] as const) as ReadonlySet<string>;

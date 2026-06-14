import { ROOT_CAUSE_CATEGORIES } from '@playwright-reports/shared';

const ROOT_CAUSE_CATEGORY_LIST = ROOT_CAUSE_CATEGORIES.join(', ');

export const TEST_ANALYSIS_SYSTEM_PROMPT =
  'Your task is to analyze a Playwright test failure from the structured evidence below and explain what broke and why. Cite line numbers, file paths, error signatures, and response codes. Be direct and specific; avoid filler and generic testing advice. Do NOT restate the report — the reader already sees the step tree, page snapshot, stack trace, console events, and error message in the UI. Quote at most the few lines that prove your conclusion. Every claim must add insight beyond what is already visible in the evidence.';

export const TEST_ANALYSIS_TASK_INSTRUCTIONS = `
Test: {{testTitle}} (project "{{project}}", {{filePath}})

Reply in plain Markdown. Use the exact section headings below. Sections 1 and 2
are required; section 3 is optional. The trailing Category line is REQUIRED.
Do not use JSON or code fences around the response.

## Root Cause
Explain what broke and why. Ground every claim in concrete evidence: line
numbers from Test Source / Step Tree / Stack, console errors, failed requests
with status codes, attempt-history differences. Do NOT restate data the reader
can already see in the report (page snapshot dumps, full step trees, raw stack
traces). Quote at most the few lines that prove your conclusion. The goal is
to add insight, not to summarize the report.

## What to Verify
List 2-3 specific checks to confirm or disprove the root cause. Each must be
directly runnable (e.g., log query, env flag to toggle, code path to inspect,
repro step). Avoid generic advice ("check the logs", "increase the timeout").

## Recommendation
Optional. Include only if you can name a clear fix (code edit, config change,
infra action). Skip this section entirely if the correct next step is just
"investigate further". Short concrete code snippets are allowed; vague
suggestions are not.

After the sections, end with exactly one footer line, on its own line, with no
heading or extra text. This line is REQUIRED — emit it even when uncertain:

Category: <one of: ${ROOT_CAUSE_CATEGORY_LIST}>

Pick the label that best matches the root cause you described above:
- app_bug: the application under test misbehaved — the test caught a real defect.
- test_bug: the test code is wrong (bad selector, missing wait, wrong assumption, race condition in the test).
- infrastructure: runner, browser, or network outage; not related to application or test logic.
- environment: test environment is in a bad state (missing data, stale fixtures, dependency unavailable, auth misconfigured).
- slow_path: the operation was progressing normally but exceeded the timeout budget — a genuine performance regression, not a hang or deadlock. The test would have passed given more time.
- unknown: the evidence is genuinely insufficient to decide.

Use "unknown" only when no specific category is supported by the evidence;
prefer a concrete label whenever the data points at one.
Category line is mandatory.

Attempt-history rules:
- eventually passed -> transient or environmental; focus on retry/wait or instability diagnosis.
- same error on all attempts -> persistent defect; focus on code or state.
- different error per attempt -> state leakage between attempts; suspect fixtures or shared state.

The canonical Error block comes from the first failing attempt. Attempt History shows the full attempt timeline.
`;

export const TEST_ANALYSIS_VARS = new Set([
  'project',
  'testTitle',
  'filePath',
] as const) as ReadonlySet<string>;

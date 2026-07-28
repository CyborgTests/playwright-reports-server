import { ROOT_CAUSE_CATEGORIES } from '@playwright-reports/shared';

const ROOT_CAUSE_CATEGORY_LIST = ROOT_CAUSE_CATEGORIES.join(', ');

export const TEST_ANALYSIS_SYSTEM_PROMPT = `You are a test-failure analyst for Playwright test suites. You read the structured failure evidence for a single test - step tree, test source, stack trace, console events, network activity, page snapshot, and attempt history - and explain what broke and why.

How you work:
- Lead with the root cause, then support it. Ground every claim in the evidence: cite file paths, line numbers, error signatures, and HTTP status codes from the data.
- Add insight the reader cannot get from the evidence alone. The step tree, page snapshot, stack trace, console events, and error message are already on screen - reference their key lines and quote only the few that prove your conclusion.
- Stay direct and specific. Skip filler and generic testing advice such as "add a wait" or "check the logs".
- When the evidence is too thin to decide, say what is missing.
- Respond as plain Markdown starting at the first heading; keep the response out of a code fence.`;

export const TEST_ANALYSIS_TASK_INSTRUCTIONS = `
<task>
Analyze the failure of test {{testTitle}} - project "{{project}}", {{filePath}}. The structured failure evidence follows in <evidence> below.
</task>

<output_format>
Sections 1 and 2 are required, section 3 is optional, and the closing Decision and Category lines are required. Use these exact headings:

## Root Cause
What broke and why, tied to specific evidence: line numbers from the test source, step tree, or stack; console errors; failed requests and their status codes; differences between attempts. Whenever you cite a failed, blocked, or pending request, name the role you assigned it - product API, depended-on integration, or fire-and-forget - so the reader can check that call.

## What to Verify
2-3 runnable checks that confirm or rule out the root cause - a log query, an env flag to toggle, a code path to inspect, a repro step.

## Recommendation
A concrete fix - code edit, config change, or infra action (short snippet welcome). Include only with such a fix; omit when the next step is just to investigate further.

Close with two footer lines, each on its own line - first the ladder answers, then the category they select:

Decision: D1=<yes|no> D2=<yes|no> D3=<yes|no> D4=<yes|no>
Category: <one of: ${ROOT_CAUSE_CATEGORY_LIST}>

The Category must equal the category chosen by the FIRST "yes" in your Decision line, or unknown if every answer is no, and must match the Root Cause you wrote above.
</output_format>

<category_ladder>
Choose the category by answering D1-D4 in order. The FIRST "yes" decides it - stop there and do not re-open earlier answers. Every label answers one question: what has to change to make this test pass?

Before answering, work through <reading_network_activity> for any failed or pending request, and <reading_element_not_found> for a locator, visibility, or element-not-found error. Both narrow which D can honestly answer yes.

D1. Broken precondition? Did it fail because of auth (an expired or invalid stored session, 401/403 from auth endpoints, a redirect to a sign-in page), missing or stale data/fixtures, an unavailable dependency, or a runner/browser/network outage?
    yes → environment

D2. Test's own fault? A bad selector, a missing or too-short wait, a wrong assumption, a race in the test, or an assertion that encodes the wrong expectation? Also yes when the target element or text IS present under a different name, role, label, or wording than the locator demands - a stale or over-specific locator is the test's fault.
    yes → test_bug

D3. Just slow? The operation actually progressed and would have completed correctly given more time, but exceeded the timeout budget - a genuine performance regression, not a hang or deadlock? A request still in flight when a short timeout fired is slowness; one that never responded across the entire long budget is a hang, so that is D1, not D3.
    yes → slow_path

D4. Wrong result for a VALID request? The app was driven correctly and still returned a wrong result. An app correctly REJECTING a bad request - a 401/403, a redirect to sign-in, a validation error on bad input - is the RIGHT result, so answer no (that case was already D1 environment, never app_bug). A locator that failed to match a control the page snapshot shows as RENDERED is D2, never app_bug.
    yes → app_bug

If every answer is no, the evidence is insufficient to decide → unknown. Reserve unknown only for that case; still emit both footer lines.
</category_ladder>

<reading_attempt_history>
The Error block is from the first failing attempt; Attempt History holds the full timeline.
- Eventually passed → transient or environmental: focus on retry, wait, or instability.
- Same error every attempt → persistent defect: focus on code or state.
- Different error per attempt → state leakage between attempts: suspect fixtures or shared state.
</reading_attempt_history>

<reading_network_activity>
Not every failed, blocked, or pending request - and not every console error - affects the test. Classify each one by what it does for the app, from the URL path, the method, and the body when shown. Never from the domain alone: an app's own API often sits on a separate API domain, CDN, or regional host, and the app's own domain also serves telemetry.

- Product API - the app's own backend: REST/GraphQL-shaped paths, credentialed calls (a cookie or authorization request header, shown as [redacted]), responses the page renders. Can support D1 when it is unreachable, or D4 when it answers a valid request wrongly.
- Depended-on integration - auth/SSO, payments, feature flags, maps, chat: the flow cannot continue until it responds. Can support D1 when it is unavailable, or D4 when the app mishandles a valid response.
- Fire-and-forget - analytics, tracking, telemetry, logging and beacon endpoints, session replay, ads, and the vendor scripts a CSP blocks. These fail on healthy pages constantly, on the app's own domain as readily as a vendor's, and support NO category on their own.

Dependency check: did the failing action need this response to proceed? Only requests that pass it may carry your root cause. When every failed, blocked, or pending entry is fire-and-forget, the network and console blocks support NEITHER environment NOR app_bug - decide from the remaining evidence or answer unknown. When a request's role is unclear from the evidence, say so rather than assume it broke the app.

Timeout budget: for a request the failing action awaited that never got a response, the timeout that actually fired decides between D3 and D1. Weigh it - the error message names the timeout that expired, and the step tree shows how long the failing step ran.
- Still in flight when a SHORT timeout expired (roughly 10s or less): the page was simply not finished yet → D3 slow_path.
- No response across the ENTIRE long budget (roughly 30s or more), with no progress anywhere in that window: a hung dependency → D1 environment.
</reading_network_activity>

<reading_element_not_found>
A visibility or element-not-found failure - toBeVisible, waitFor, an expect or locator timeout on an element - is a SYMPTOM with four different causes, and it is never a category on its own. Read the page snapshot and step tree to find which one applies. Absence must be PROVEN: a truncated, short, or still-loading snapshot is not evidence that an element is missing.

- Page never finished rendering - skeletons, spinners, a snapshot that stops mid-layout, an awaited request still pending → the app was still working: D3 slow_path, or D1 environment when what it awaited never responded at all.
- Wrong or blocked page - sign-in, a consent or permission wall, 404, an outage or error page → D1 environment. The app redirecting or refusing is the RIGHT behavior, not a defect.
- Element IS in the snapshot, under a different name, role, text, or label than the locator demands → D2 test_bug, a stale or over-specific locator.
- Page is fully rendered and healthy and the element is genuinely absent from the snapshot → D4 app_bug. This is the ONLY branch where a missing element is the app's fault.

If the snapshot cannot settle which branch applies, name what is missing and answer unknown rather than defaulting to app_bug.
</reading_element_not_found>
`;

export const TEST_ANALYSIS_VARS = new Set([
  'project',
  'testTitle',
  'filePath',
] as const) as ReadonlySet<string>;

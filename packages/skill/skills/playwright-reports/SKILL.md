---
name: playwright-reports
description: Access Playwright Reports Server data for failing tests, flakiness, and historical run analysis. Use when the user mentions a failing test, flakiness, a `.spec.ts` file under suspicion, asks "what failed in the last run", asks "why is X failing", passes a reportId from CI, or asks any aggregate/digest question about test runs over a time window ("what's flaky this week", "how did staging do yesterday", "compare last two reports").
allowed-tools: Bash(pwrs-cli *)
---

# Playwright Reports — Test Context

Every command returns JSON. Error messages, LLM analyses, and cluster members
pass through verbatim. The CLI is read-only — there is no way to mutate state
from here.

## Drill-down workflows (you have an ID)

**You have a test name** (from a CI log, error, or the user) →
```
pwrs-cli test find "fragment of the title" [--project <p>]
pwrs-cli test brief <testId> --file-id <fileId> --project <project>
```

**You have a spec file path** →
```
pwrs-cli test from-file tests/checkout.spec.ts
pwrs-cli test brief <testId> --file-id <fileId> --project <project>
```

**You have a reportId, or want to triage the latest run** →
```
pwrs-cli report brief <reportId>
pwrs-cli report latest [--project <p>]
```
Returns the report's failed tests pre-briefed AND a `clusterSummary` rolling up which failures share a root cause. **When a cluster has N tests, fix the cluster once — don't iterate over each member.**

## Discovery workflows (no ID yet)

**"What projects are tracked?"** → `pwrs-cli project list`

**"What tags exist?"** → `pwrs-cli tag list [--project <p>]` (pairs with `report list --tags <a,b>`).

**"What reports ran [in a window / with failures / matching X]?"** →
```
pwrs-cli report list \
    [--project <p>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] \
    [--pass-rate failing|below-threshold|passing|all] \
    [--search <text>] [--tags <a,b>] [--limit N]
```
Returns compact rows (`{ reportId, project, displayNumber, createdAt, stats }`). Drill into any row with `report brief <reportId>`.

**"What's flaky / quarantined / failing-with-category-X right now?"** →
```
pwrs-cli test search \
    [--project <p>] [--tier flaky|critical|stable] \
    [--status quarantined|not-quarantined] \
    [--failure-category <c>] [--sort slowest] \
    [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--search <text>] [--limit N]
```
Returns a compact roster (`{ testId, fileId, project, title, flakinessScore, isQuarantined, totalRuns, lastRunAt }`). Drill into any test with `test brief`.

**"How is the project doing this week?"** →
```
pwrs-cli stats [--project <p>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--failed-only]
```
Returns `{ overview, tests, failureCategories, recentRunsCount }` — pass-rate, trend deltas vs the prior equal-length window, flaky count, slowest steps, failure-category breakdown. Use for any "digest" question. Use `--failed-only` to scope to runs that had failures.

**"What failure clusters are active?"** →
```
pwrs-cli cluster list [--project <p>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--strategies signature,stack-frame,fixture,temporal] [--min-tests N] [--limit N]
```
Returns the highest-blast-radius clusters first (testCount × failureCount). Same fix-the-cluster-not-the-test rule applies.

**"What changed between these two reports?"** →
```
pwrs-cli report compare <reportIdA> <reportIdB> [--limit N]
```
Returns `{ summary, newlyFailed, fixed, stillFailing, flakyToPass, passToFlaky, newTests, removedTests, durationDeltas }`. Each diff bucket is capped at `--limit` (default 20) — `bucketsTruncated: true` warns when there's more.

## What `test brief` returns

```
{
  testId, fileId, project, title, filePath,
  signals: { quarantined, flakinessScore, occurrenceCount, firstSeen, isClustered },
  latestFailure: {
    error,        // full Playwright error message
    category,     // heuristic: timeout, navigation_error, …
    signature,    // stable hash — same signature = same bug
    location,     // { file, line, column } — jump-to in the spec
    appFrame,     // first non-Playwright stack frame, normalized to "path:line"
    reportId, reportUrl, createdAt,
    attachments: { screenshotUrl, errorContextUrl } | null
  },
  llmAnalysis: { rootCause, fix, model } | null,   // pre-computed if present
  feedback: { comment, updatedAt } | null,         // team-curated note
  cluster: { id, strategy, name, sampleError, otherTests } | null
}
```

## What `report brief` adds

```
{
  reportId, displayNumber, title, project, createdAt, reportUrl, stats,
  clusterSummary: [{ id, strategy, name, sampleError, testCount, testIds }],
  unclusteredFailures: N,
  failedTestsTruncated: bool,   // true when more than 50 failed
  failedTests: [<brief>, <brief>, …]
}
```

## How to use the signals

- `signals.quarantined: true` → don't bother, the team already marked it broken
- `signals.flakinessScore` > 5 with no `feedback` → likely flaky, look for infra before code
- `signals.occurrenceCount` > 1 with stable `signature` → real regression, fix it
- `signals.firstSeen` → correlate with deploys / PRs
- `feedback` present → read it first; it overrides everything else
- `llmAnalysis.rootCause` present → start from this hypothesis, don't re-derive
- `cluster` present → **fix the cluster, not the test** — every member resolves together
- `latestFailure.attachments.screenshotUrl` → fetch the PNG, look at it — for UI failures this often answers the question instantly
- `latestFailure.attachments.errorContextUrl` → fetch the markdown — Playwright generates this for AI agents (DOM snapshot + recent actions + console)
- `latestFailure.reportUrl` → open with `WebFetch` if you need the full Playwright HTML report

## Date filters

All time-windowed commands take `--from` / `--to` as ISO dates (`YYYY-MM-DD`
or full ISO timestamp).
For relative time periods, compute `--from` and `--to` correspondingly.

## Setup (one-time, by the user)

```
pwrs-cli config set server https://reports.example.com
pwrs-cli config set token <api-token>
```
Or `PRS_SERVER_URL` / `PRS_API_TOKEN` env vars (override the saved config).

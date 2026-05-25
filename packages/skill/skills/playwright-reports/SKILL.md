---
name: playwright-reports
description: Access Playwright Reports Server data for failing tests, flakiness, and historical run analysis. Use when the user mentions a failing test, flakiness, a `.spec.ts` file under suspicion, asks "what failed in the last run", asks "why is X failing", passes a reportId from CI, or asks any aggregate/digest question about test runs over a time window ("what's flaky this week", "how did staging do yesterday", "compare last two reports").
allowed-tools: Bash(pwrs-cli test:*), Bash(pwrs-cli report:*), Bash(pwrs-cli cluster:*), Bash(pwrs-cli project:*), Bash(pwrs-cli tag:*), Bash(pwrs-cli category:*), Bash(pwrs-cli stats:*), Bash(pwrs-cli ping:*), Bash(pwrs-cli attachment:*), Bash(pwrs-cli help:*), Bash(pwrs-cli --help), Bash(pwrs-cli --version), Bash(pwrs-cli config get:*)
---

# Playwright Reports — Test Context

Every data command returns JSON; Error messages, LLM analyses, and cluster members pass through verbatim. The CLI is read-only — the only mutation it can do is `config set` (server URL / token) that works with local file.

## Drill-down workflows (you have an ID)

**You have a testId** (the common case — lifted from a CI URL, stack trace, or a previous `test find`) →
```
pwrs-cli test brief <testId>          # server resolves fileId+project from the latest run
pwrs-cli test history <testId>        # per-run history — see "Per-run history" below
```
Pass `--project <project>` only when the server's auto-resolution returns the
wrong run (e.g. an obsolete project for the same testId).

**You have a testId AND a reportId, and the brief's `llmAnalysis` isn't enough** →
```
pwrs-cli test analysis <testId>                                # full LLM markdown (unmodified)
pwrs-cli test analysis-prompt <testId> --report-id <reportId>  # the prompt+response we sent last time
pwrs-cli test failure-context <testId> --report-id <reportId>  # fresh would-be prompt + raw evidence
```
Three escape hatches with different shapes:
- `test analysis` → the LLM's persisted markdown output. Use when the regex split in `brief.llmAnalysis` lost a section.
- `test analysis-prompt` → `{ markdown, taskId, model, completedAt, analysisText, … }`. The verbatim prompt the queue *previously* sent to the LLM for this `(testId, reportId)`, alongside the response. Mirrors the in-report "Copy prompt" button. Pass `--task-id <id>` to address a specific historical run. 404 if no completed task exists for this pair.
- `test failure-context` → `{ markdown, segments, evidence, attachments, heuristicCategory, meta }`. The prompt the queue would build **right now** (no LLM call) plus a typed `evidence` envelope: `errorMessage`, `stackTrace`, `testSourceFrame` (codeframe), `stepTree`, `pageSnapshot` (ARIA), `stdout`, `stderr`, `testMeta`, `gitCommit`, `ciBuild`, `gitDiff`, `environment`, `consoleEvents`, `networkEvents`, `actionLog`. Use this when you want to reason from raw signals yourself instead of trusting the persisted analysis, or when no analysis exists yet.

**You have a test name** (from a CI log, error, or the user) →
```
pwrs-cli test find "fragment of the title" [--project <p>]
# → matches[0].testId — then `test brief <testId>` as above
```

**You have a spec file path** (and optionally a failing line) →
```
pwrs-cli test from-file tests/checkout.spec.ts          # all tests in that file
pwrs-cli test from-file tests/checkout.spec.ts:200      # sorted by proximity to line 200
# → matches[0].testId — then `test brief <testId>` as above
```

**You have a reportId, or want to triage the latest run** →
```
pwrs-cli report brief <reportId>             # compact: stats + cluster summary + samples
pwrs-cli report brief <reportId> --with-failures   # full briefs for every failed test
pwrs-cli report latest [--project <p>]       # sugar for "list --limit 1 | brief"
pwrs-cli report summary <reportId>           # persisted LLM failure summary, if any
```
Compact `report brief` is ~5 KB even for a 50-failure report — every cluster includes `sampleFailedTests` (top 3 per cluster), plus a few unclustered samples. Only escalate to `--with-failures` when you genuinely need every test's full error / location / LLM analysis.

`report summary` returns `{ hasFailures, pendingAnalysisCount, summary }` where `summary.llmSummaryStructured` (when present) is typed JSON: `{ verdict: 'isolated' | 'clustered' | 'widespread' | 'systemic', summary: <1–3 sentence executive summary>, sections: [{ heading, body, impact?, codeRefs[] }] }`. Read `verdict` first — `widespread`/`systemic` means the run is broken at a layer above any single test. `sections[].codeRefs` are pre-resolved `{ kind: 'test' | 'file', testId?, fileId?, filePath?, line? }` pointers so you can jump straight to the implicated tests/files.

**When a cluster has N tests, fix the cluster once — don't iterate.** Use
`pwrs-cli cluster brief <clusterId>` to get every member's brief at once.

**You want the per-run history of one test** →
```
pwrs-cli test history <testId> [--limit N]   # default 20, max 50 most-recent runs
```
Returns `{ stats, signatureGroups, runs }`. `signatureGroups` rolls up runs by `errorSignature` so you can see "failed the same way 6 times, then a new signature appeared yesterday" without scanning every entry.

## Discovery workflows (no ID yet)

**"What projects are tracked?"** → `pwrs-cli project list`

**"What tags exist?"** → `pwrs-cli tag list [--project <p>]` (pairs with `report list --tags <a,b>`).

**"What failure categories are emitted?"** → `pwrs-cli category list` — required for valid `--failure-category` values.

**"What reports ran [in a window / with failures / matching X]?"** →
```
pwrs-cli report list \
    [--project <p>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] \
    [--pass-rate failing|below-threshold|passing|all] \
    [--search <text>] [--tags <a,b>] [--limit N]
```
Returns compact rows (`{ reportId, project, displayNumber, createdAt, stats }`) plus `total` and `hasMore`. Drill into any row with `report brief <reportId>`.

**"What's flaky / quarantined / failing-with-category-X right now?"** →
```
pwrs-cli test search \
    [--project <p>] [--tier flaky|critical|stable] \
    [--status quarantined|not-quarantined] \
    [--failure-category <c>] [--sort slowest] \
    [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--search <text>] [--limit N]
```
Returns `{ total, hasMore, matches }`. Drill into any test with `test brief`.

**"How is the project doing this week?"** →
```
pwrs-cli stats [--project <p>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--failed-only]
pwrs-cli project summary [--project <p>]     # persisted LLM project health summary
```
`stats` is the numeric digest (pass rate, trend deltas, flaky count, slowest steps). `project summary` is the LLM-written digest (when one exists) — returns `{ pendingAnalysisCount, summary: { summary, structured, model, lastReportId, reportCount, firstReportAt, lastReportAt, … } }`. `summary.structured` (when present) is typed JSON: `{ verdict: 'healthy' | 'stabilizing' | 'degrading' | 'failing', summary: <1–3 sentence executive summary>, sections: [{ heading, body, codeRefs[] }] }`. Use `verdict` for a one-token project-health read; drop into `sections` only when the user wants the narrative.

**"What failure clusters are active?"** →
```
pwrs-cli cluster list [--project <p>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--strategies signature,stack-frame,fixture,temporal] [--min-tests N] [--limit N]
pwrs-cli cluster brief <clusterId>      # drill into one cluster
```
`cluster list` returns highest-blast-radius first (testCount × failureCount). Same fix-the-cluster-not-the-test rule applies.

**"What changed between these two reports?"** →
```
pwrs-cli report compare <reportIdA> <reportIdB> [--limit N]
```
Returns `{ summary, newlyFailed, fixed, stillFailing, flakyToPass, passToFlaky, newTests, removedTests, durationDeltas }`. Each diff bucket is capped at `--limit` (default 20) — `bucketsTruncated: true` warns when there's more. **Pass UUID `reportId`s, not displayNumbers.**

## How to use the signals

- `signals.quarantined: true` → don't bother, the team already marked it broken
- `signals.flakyTier === 'flaky'` → likely flaky, worth investigating. `'critical'` → likely auto-quarantineable, fix urgently. `'stable'` → ignore. The server derives this from `flakinessScore` and the active site-config thresholds — don't hardcode a percent in your prompt.
- `signals.flakinessScore` → the underlying percent (0–100), if you want the raw number alongside the tier
- `signals.signatureOccurrenceCount` > 1 with stable `signature` → real regression, fix it. **This counts prior runs of the same `latestFailure.signature`, not total runs of the test.**
- `signals.signatureFirstSeen` → when this `signature` first appeared (not the test's first run) → correlate with deploys / PRs
- `feedback` present → read it first; it overrides everything else
- `llmAnalysis.rootCause` present → start from this hypothesis, don't re-derive. For the unmodified full markdown (e.g. when the regex-split lost a section), use `pwrs-cli test analysis <testId>`. To inspect the exact prompt+response we sent, use `test analysis-prompt <testId> --report-id <reportId>`. To bypass the LLM entirely and reason from raw evidence (codeframe, step tree, ARIA snapshot, console/network/action logs, git+CI), use `test failure-context <testId> --report-id <reportId>`.
- `llmAnalysis: null` *with* a failing run → analysis hasn't been generated. Pull `pwrs-cli test failure-context <testId> --report-id <reportId>` and reason from the `evidence` envelope yourself rather than waiting.
- `cluster` present → **fix the cluster, not the test** — every member resolves together
- **Before assuming it's *your* test, check the report-level verdict.** `pwrs-cli report summary <reportId>` → `summary.llmSummaryStructured.verdict`: `widespread`/`systemic` means fix the run (infra, fixtures, deploy), not the test. For multi-day patterns, escalate one more level: `pwrs-cli project summary [--project <p>]` → `summary.structured.verdict` (`healthy` / `stabilizing` / `degrading` / `failing`).
- `latestFailure.attachments.screenshotUrl` → fetch the PNG for UI failures
- `latestFailure.attachments.errorContextUrl` → fetch the markdown (DOM snapshot + recent actions + console — Playwright generates this for AI agents)
- `latestFailure.reportUrl` → the full Playwright HTML report

**Fetching attachments / `reportUrl`:** these are server-relative paths. The convenient form is `pwrs-cli attachment <url>` — it handles the URL resolution and Bearer auth and emits `{ content, encoding: "utf8" | "base64", contentType, bytes }`. Use `WebFetch` directly only when you specifically need a streaming/HTML render; in that case prepend `$PWRS_SERVER_URL` and send `Authorization: Bearer $PWRS_API_TOKEN`.

**`outcome` vocabulary:** `test history` runs and `report brief.stats` both use the normalized values `passed | failed | flaky | skipped`. (The raw Playwright terms `expected` / `unexpected` are mapped to `passed` / `failed` server-side.)

## Common gotchas

- **`flakinessScore` is 0–100 (a percent), not 0–1.** The flagging threshold is configurable (defaults: warning ≥ 2%, quarantine ≥ 5%). **Prefer reading `signals.flakyTier`** — the server already classifies the test using the active config.
- **`report compare` takes UUID reportIds, not displayNumbers.** If you only see `#479` in CI, use `pwrs-cli report resolve 479` to get the UUID. The compare command also accepts the keywords `latest` and `prev` (e.g. `report compare prev latest`).
- **`report brief` is compact by default and uses a discriminated `mode` field.** When `mode === 'summary'`, the payload has `sampleUnclusteredFailures`. When `mode === 'full'` (from `--with-failures`), it has `failedTests` instead. Both modes carry `clusterSummary[].sampleFailedTests`. Full mode on a 50-failure report is ~100 KB — use sparingly.
- **`--failure-category` values are heuristic-emitted strings.** Run `category list` first to see the exact spellings. The same concept appears as `latestFailure.category` and `cluster.category` in briefs, as the `--failure-category` CLI flag, and as the `failureCategory` query param — all reference the same vocabulary.
- **`test from-file <path>:<line>` sorts by proximity** to the failing line — pass it when you have a CI stack frame.
- **`test brief` / `test history` — the server resolves it from the latest `test_runs` row.
- **Pagination signals**: `total` + `hasMore` appear on every list-returning command (`test find/search`, `report list`, `cluster list`). When `hasMore: true`, pass `--offset` (where supported) or raise `--limit`.
- **Errors are JSON on stderr**: failed CLI calls emit `{"success":false,"error":"…","kind":"http|config|unknown",…}` and exit non-zero. Parse both stdout and stderr.
- **Sanity check**: `pwrs-cli ping` returns `{ ok, server, tokenConfigured, latencyMs, … }` — use this if a command unexpectedly fails to confirm config without issuing a real query.

## Date filters

All time-windowed commands take `--from` / `--to` as ISO dates (`YYYY-MM-DD`
or full ISO timestamp). For relative time periods, compute `--from` and
`--to` correspondingly. **There is no `--since` flag** — always pass explicit ranges.

## Setup (one-time, by the user)

```
pwrs-cli config set server https://reports.example.com
pwrs-cli config set token <api-token>
```
Or `PWRS_SERVER_URL` / `PWRS_API_TOKEN` env vars (override the saved config).

For single-project setups, export `PWRS_PROJECT=<name>` to default `--project`
across every command (explicit `--project` still wins).

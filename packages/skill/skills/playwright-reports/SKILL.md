---
name: playwright-reports
description: Pull Playwright Reports Server context - failing tests, flakiness, run history, failure clusters, and LLM-written analyses. Trigger on mentions of a failing test, flaky run, `.spec.ts` file under suspicion, a CI reportId, "what failed in the last run", "why is X failing", or aggregate questions like "what's flaky this week" / "compare last two reports".
allowed-tools: Bash(pwrs-cli test:*), Bash(pwrs-cli report:*), Bash(pwrs-cli cluster:*), Bash(pwrs-cli project:*), Bash(pwrs-cli tag:*), Bash(pwrs-cli category:*), Bash(pwrs-cli stats:*), Bash(pwrs-cli ping:*), Bash(pwrs-cli attachment:*), Bash(pwrs-cli regression:*), Bash(pwrs-cli help:*), Bash(pwrs-cli --help), Bash(pwrs-cli --version)
---

<!-- cspell:words pwrs unclustered quarantineable -->

# Playwright Reports

Access to the Playwright Reports Server. Every command returns JSON; error messages, LLM analyses, and cluster members pass through verbatim.

**Use this skill when** the user asks why a test is failing, what's flaky, what changed between runs, or any aggregate question over a time window.

**Skip this skill for** writing new tests, modifying `playwright.config.ts`, running tests locally, or any task that doesn't touch historical run data.

The CLI is read-only. Write commands (`analysis-submit`, `summary-submit`, `feedback`) live in `authoring.md` and are loaded only when the user explicitly asks to author or dissent.

## Quick reference

| Goal | Command | Returns |
|---|---|---|
| Triage a known test | `pwrs-cli test brief <testId>` | signals + latest failure + LLM analysis + cluster |
| Triage a whole report | `pwrs-cli report brief <reportId>` | stats + cluster summary + sample failures |
| Latest report (sugar) | `pwrs-cli report latest [--project p]` | same as `report brief` on the most recent |
| Find by test name | `pwrs-cli test find "fragment"` | `matches[].testId` |
| Find by file path | `pwrs-cli test from-file <path>[:line]` | `matches[].testId`, line-ranked |
| What's flaky now | `pwrs-cli test search --tier flaky` | filtered test roster |
| What ran in a window | `pwrs-cli report list --from --to` | paginated reports |
| Active failure clusters | `pwrs-cli cluster list` | top clusters by impact |
| All clusters incl. resolved | `pwrs-cli cluster list --include-resolved` | full list with lifecycle state |
| Drill into a cluster | `pwrs-cli cluster brief <id>` | full member roster |
| Active regressions (broke recently) | `pwrs-cli regression list [--active] [--sort impact\|recent\|oldest]` | tests in green→red state with commit attribution |
| Diff two reports | `pwrs-cli report compare A B` | newlyFailed / fixed / stillFailing / … |
| Per-run history of a test | `pwrs-cli test history <testId>` | runs + signatureGroups |
| Verdict on a report | `pwrs-cli report summary <id>` | persisted LLM summary + verdict |
| Project health digest | `pwrs-cli project summary` | persisted LLM project summary + verdict |
| Numeric stats | `pwrs-cli stats --from --to` | pass rate, trends, slowest |
| Raw failure evidence | `pwrs-cli test failure-context <id> --report-id <r>` | typed evidence envelope |
| Inspect the prompt we sent | `pwrs-cli test analysis-prompt <id> --report-id <r>` | verbatim prompt + response |
| Full LLM markdown | `pwrs-cli test analysis <testId>` | unmodified analysis |
| `#479` → UUID | `pwrs-cli report resolve 479` | matching reportIds |
| Discover projects/tags/categories | `pwrs-cli project list` / `tag list` / `category list` | string arrays |
| Attachment metadata | `pwrs-cli attachment <url>` | URL + content-type + bytes (HEAD) |
| Sanity check | `pwrs-cli ping` | server + token + latency |

All list-returning commands carry `total` + `hasMore`. Defaults: `report list`/`test search`/`report compare` = 20, `cluster list` = 10, `test history` = 20 (max 50), `regression list` = 25 (max 200). For exact flags run `pwrs-cli help <group>` or `pwrs-cli <command> --help`.

## Project identification

Most commands accept `--project` to scope data. If the user's query doesn't name a project, **identify the project first** - don't guess or omit it silently.

```bash
pwrs-cli project list    # → { "projects": ["head:main", "staging:main", "e2e:local:sh"] }
```

`project list` returns all known project names - use exact string values from this list in `--project`. Projects are named by the reporter config, not by you.

**When to pass `--project`:**
- **User names a project** ("how's staging?") → use the matching string from `project list` (e.g. `staging:main`).
- **User doesn't name a project and only one project exists** → use it implicitly, don't ask.
- **User doesn't name a project and multiple projects exist** → ask which project they mean, or if the question is aggregate ("overall health"), omit `--project` to get cross-project results. Commands without `--project` return data across all projects.
- **`PWRS_PROJECT` env var is set** → it serves as the default; explicit `--project` still wins. You can check if it's set via `pwrs-cli config get`.

**Cross-project (`--project` omitted or `all`):**
- `test find` / `test search` return results from all projects - the `project` field on each row tells you which project it belongs to.
- `project summary` without `--project` produces a cross-project digest. Per-project summaries are more specific; prefer them when the user asks about one area.
- `report list` / `stats` / `cluster list` aggregate across projects when `--project` is omitted.

**Don't assume project names.** Project names vary by server (e.g. `chromium`, `staging:main`, `head:main`, `nightly`). Always start from `project list` output.

## Worked examples

**User: "Why is the checkout test failing?"**
```bash
pwrs-cli project list                   # → identify available projects first
pwrs-cli test find "checkout"           # → matches[]; each row has a `project` field
# If matches span multiple projects, ask the user which one, or pick the project they're working in.
pwrs-cli test brief <testId>            # → signals + latestFailure + llmAnalysis + cluster
```
If `cluster` is non-null, fix at `cluster.anchor`, not the test. If `llmAnalysis: null`, fall back to `pwrs-cli test failure-context <testId> --report-id <reportId>` and reason from the `evidence` envelope yourself.

**User: "How did staging do yesterday?"**
```bash
pwrs-cli project list                   # → confirm exact project name (e.g. "staging:main")
pwrs-cli report list --project "staging:main" --from 2026-06-08 --to 2026-06-08
# → reports[0].reportId
pwrs-cli report brief <reportId>        # compact: 5 KB even on a 50-failure report
pwrs-cli report summary <reportId>      # → verdict ('isolated' | 'clustered' | 'widespread' | 'systemic')
```
Read `summary.llmSummaryStructured.verdict` first - `widespread`/`systemic` means the run is broken at a layer above any single test (infra, fixtures, deploy); don't drill into individual tests in that case.

## Workflows

### Discovery (no ID yet)

```bash
pwrs-cli project list                                       # what projects are tracked
pwrs-cli tag list [--project p]                             # what tags exist (pairs with report list --tags)
pwrs-cli category list                                      # valid --failure-category values

pwrs-cli report list [--project p] [--from --to] \
    [--pass-rate failing|below-threshold|passing|all] \
    [--search text] [--tags a,b]                            # reports in a window

pwrs-cli test search [--project p] [--tier flaky|critical|stable] \
    [--status quarantined|not-quarantined] \
    [--failure-category c] [--sort slowest] \
    [--from --to] [--search text]                           # tests matching open-ended filters

pwrs-cli stats [--project p] [--from --to] [--failed-only]  # numeric digest
pwrs-cli project summary [--project p]                      # LLM-written digest + verdict

pwrs-cli cluster list [--project p] [--from --to] \
    [--include-resolved]                                    # failure clusters (active only by default)
```

### Drill-down (you have an ID)

```bash
# Test:
pwrs-cli test brief <testId>                                # everything we know about this test
pwrs-cli test history <testId> [--limit N]                  # per-run history + signatureGroups
pwrs-cli test analysis <testId>                             # full LLM markdown (use when brief.llmAnalysis lost a section)

# Test + report:
pwrs-cli test failure-context <testId> --report-id <r>      # fresh prompt + typed evidence envelope (no LLM call)
pwrs-cli test analysis-prompt <testId> --report-id <r>      # verbatim prompt + response from the last completed task

# Report:
pwrs-cli report brief <reportId>                            # compact: stats + clusterSummary + sample failures
pwrs-cli report brief <reportId> --with-failures            # full brief per failed test (~100 KB on a 50-failure report)
pwrs-cli report summary <reportId>                          # persisted LLM summary + verdict
pwrs-cli report compare <reportIdA> <reportIdB>             # diff buckets (accepts `latest` / `prev` keywords)

# Cluster:
pwrs-cli cluster brief <clusterId>                          # full member roster + per-member brief
```

`--project` is optional for `test brief` / `test history` / `test analysis*` - the server resolves the canonical `(fileId, project)` lane from the test's most recent run. Pass it only when auto-resolution picks the wrong lane (e.g. an obsolete project sharing a testId).

### From a file path or stack frame

```bash
pwrs-cli test from-file tests/checkout.spec.ts              # all tests in that file
pwrs-cli test from-file tests/checkout.spec.ts:200          # sorted by proximity to line 200
```

### `failure-context` evidence envelope

`test failure-context` returns `{ markdown, segments, evidence, attachments, heuristicCategory, meta }`. The `evidence` envelope is the typed shape the LLM queue uses:

`errorMessage`, `stackTrace`, `testSourceFrame` (codeframe), `stepTree`, `pageSnapshot` (ARIA), `stdout`, `stderr`, `testMeta`, `gitCommit`, `ciBuild`, `gitDiff`, `environment`, `consoleEvents`, `networkEvents`, `actionLog`.

Use this when you want to reason from raw signals (faster + cheaper than the LLM-mediated path) or when no analysis exists yet.

## Interpreting signals

Decision rules - apply top-to-bottom. Field shapes live in the workflow section above.

1. **`feedback` present** → trust the team's note, override everything else.
2. **`signals.quarantined: true`** → skip; the team already marked it broken.
3. **Report-level verdict first.** Before assuming it's *your* test, read `report summary <reportId>` → `summary.llmSummaryStructured.verdict`. `widespread`/`systemic` means fix the run (infra, fixtures, deploy), not the test. For multi-day patterns, escalate to `project summary` → `summary.structured.verdict`.
4. **`regression` present** → a tracked green→red transition. `regression.regressedAtCommit` + `regression.lastGreenCommit` define the suspect range; frame the fix around what landed there, not chronic flake. On `cluster brief`, `regressionContext.sharedRegressionCommit` (when set) means ≥80% of the cluster regressed at one commit.
5. **`cluster` present** → fix at `cluster.anchor`, not the test. Every member likely resolves together.
6. **`signals.flakyTier`** → `critical` urgent, `flaky` investigate, `stable` ignore.
7. **`signals.signatureOccurrenceCount > 1` with a stable `signature`** → recurring failure. Counts prior runs of the same `latestFailure.signature`, not total. Distinct from `regression`: a signature can recur without a green→red transition.
8. **`signals.signatureFirstSeen`** → likely correlate with deploys / PRs.
9. **`llmAnalysis.rootCause` present** → start from this hypothesis. Use `test analysis` for the unmodified markdown, `test analysis-prompt` to inspect what the model saw.
10. **`llmAnalysis: null` with a failing run** → analysis hasn't been generated. Pull `test failure-context` and reason from `evidence` yourself rather than waiting.

### Cluster anchors

`cluster.anchor` is the deterministic fix target, discriminated by `anchor.kind`:

- `fixture` → `{verb, phase, filePath}` - a `beforeAll`/`beforeEach`/`afterAll`/`afterEach` hook failed and cascaded. Fix the hook once.
- `selector` → `{verb, selector}` - N tests share a failing Playwright locator. Usually one UI drift breaking many tests; fix the selector or the element.
- `frame` → `{verb, frame}` - N tests crash at the same `file:line` of app code. The frame is the literal fix location.
- `signature` → `{verb, signature}` - N tests share a normalized error signature but no extractable fixture/selector/frame. Usually a deep-stack pattern (timeouts, framework errors) the extractors can't pin to one line. No single fix location - start from `sampleError` + the per-member `failure-context`, and look for a common cause (shared timeout budget, flaky dependency, infra).
- `unmatched` → `{testId, fileId, project}` - no extractable shared mechanism. Treat as a single-test failure; the cluster only groups repeated occurrences of the same test.

Each cluster carries `confidence: 'high' | 'medium' | 'low'`. `cluster list` returns anchor + counts only - drill into `cluster brief <id>` for the full membership. In `test brief`, `cluster.otherTests` is capped at 5; when `cluster.otherTestsTruncated: true`, use `cluster brief` for the full roster (`cluster.otherTestsTotal` is the true size).

### Cluster lifecycle

`lifecycle`: `active` (recent failures, not resolved) | `resolved` (fix landed or auto-resolved; carries `resolution: {resolvedAt, note?, manual}`) | `unattributed` (no override, treated as active). `cluster list` returns active only; pass `--include-resolved` for all. If resolved + failures reappeared → `cluster reopen`. If `resolution.note` is set, read it first.

### Verdict vocabularies

| Source | Field | Values |
|---|---|---|
| `report summary` | `summary.llmSummaryStructured.verdict` | `isolated` / `clustered` / `widespread` / `systemic` |
| `project summary` | `summary.structured.verdict` | `healthy` / `stabilizing` / `degrading` / `failing` |

`structured.sections[].codeRefs[]` carry pre-resolved `{ kind, testId?, fileId?, filePath?, line? }` pointers - jump straight to the implicated tests/files.

### Regressions

A **regression** is a tracked green → red state transition for one test - different from a chronic flake. The server records it on the failing run, closes it on the next passing run, and attributes the breakage to the commit that landed in between (when git metadata is available).

#### When to reach for it

| Question | Command |
|---|---|
| "Did this deploy break anything?" | `pwrs-cli regression list --active --sort recent` |
| "What's been broken longest?" | `pwrs-cli regression list --active --sort oldest` |
| "What recovered this week?" | `pwrs-cli regression list --resolved --from <date>` |
| "Is *this* test a regression or chronic flake?" | `pwrs-cli test brief <testId>` → read `regression` field |
| "Did one commit break multiple tests?" | `pwrs-cli cluster brief <id>` → read `regressionContext.sharedRegressionCommit` |
| "What's the regression load right now?" | `pwrs-cli stats` → `regressions: { active, newInWindow, resolvedInWindow, medianMttrDays }` |

`--active` (still failing) and `--resolved` (closed) are mutually exclusive; omit both to see everything. Sort defaults to `impact` = `failureCount × daysOpen`.

#### Cross-command surfacing

The same regression signal threads through every brief - you usually don't need a separate `regression list` call:

- `test brief.regression` - `null` when the test isn't currently regressed. When set: `{ regressedAtCommit, lastGreenCommit, daysOpen, failureCount, flakyCount, regressedAtReportId, lastGreenReportId }`. The commit pair is your bisect window.
- `cluster brief.regressionContext` - `null` when no cluster member is regressed. When set: `{ membersInRegression, totalMembers, sharedRegressionCommit, earliestRegression }`. `sharedRegressionCommit` is set when ≥80% of members regressed at the same commit → that's a deploy-induced cluster, fix once at the commit, not per-test.
- `report brief.regressions` - `null` when this report neither opened nor resolved any regressions. When set: `{ newHere, resolvedHere }`. Lets you ask "did this CI run introduce/fix breakage?" without diffing against the previous run.
- `report compare.summary.regressionsOpenedBetween` / `regressionsResolvedBetween` - drop-in deploy-window counts.
- `stats.regressions` - project-wide rollup, scoped to the `--from` / `--to` window.

#### Filtering the test roster by regression state

| Want | Flag |
|---|---|
| Only currently-regressed tests | `test search --regressed-only` |
| Tests that opened a regression in window | `test search --regressed-since <date>` |
| Tests whose regression resolved in window | `test search --resolved-since <date>` (Note: only resolution date is filterable; combine with `--from`/`--to` for run-window scoping.) |
| Sort by oldest open regression | `test search --sort regression-age` |

Combine with `--tier`, `--project`, `--failure-category` like any other test filter.

#### Decision rule (use this when interpreting `test brief`)

If `regression` is non-null, the test is in an active green→red state - frame the analysis as **"what landed between `lastGreenCommit` and `regressedAtCommit`"**, not as "this test has been flaky." If `regression` is null but `signals.signatureOccurrenceCount > 1`, you're looking at a *recurring* signature on a test that never had a regression event - likely a chronic flake or a never-was-green test. Different fix.

Excluded automatically from `regression list --active`, the `Active` widget tile, and `test search --regressed-only`: quarantined tests and tests whose latest outcome is `skipped`. If you need those, drop the `--active` filter and check `isActive` per row.

#### Investigating an active regression

1. **Check existing work.** `test brief.llmAnalysis` → hypothesis to verify. `feedback` set → trust the team note.
2. **Pull evidence.** `pwrs-cli test failure-context <testId> --report-id <regression.regressedAtReportId>` - returns errorMessage, stackTrace, testSourceFrame, pageSnapshot, consoleEvents, networkEvents, gitCommit, gitDiff, ciBuild, environment, actionLog.
3. **Classify.** `appFrame` in test tree → **test bug**. `appFrame` in app tree → **app bug**. No `appFrame` / framework-only → **infra**. HTTP errors in networkEvents → **app bug** at API layer.
4. **Determine repo for `regressedAtCommit`.** Check `evidence.gitDiff` (test files → test repo, app files → app repo, both → monorepo), `gitCommit.branch`, `runContext.appCommit`/`deployedSha`, `ciBuild.buildHref`. If ambiguous, ask the user - don't guess.
5. **Bisect.** `git log --oneline <lastGreen>..<regressed>` + `git diff <lastGreen>..<regressed> -- <suspect-file>` in the correct repo. If the suspect file isn't in the available repo, say so explicitly.
6. **Cross-check.** `cluster.regressionContext.sharedRegressionCommit` → that commit broke ≥80% of the cluster. `signatureFirstSeen` recent → narrow bisect. Same failure cross-project → likely infra. `flakyTier=critical` + regression → don't declare fixed on one green.
7. **Caveats to flag.** Force-push → SHAs unreachable. Squash merge → diff the PR branch. No git context → fall back to CI timestamps. `lastGreenCommit=null` → verify via `test history`. `flaky` outcome doesn't open/close regressions; confirm recovery with two consecutive greens.
8. **Write up.** Reference: (a) commit SHA, (b) file:line changed, (c) file:line caught by test, (d) propagation path. Name what's missing.

## Common gotchas

- **`flakinessScore` is a percent (0–100), not a fraction.** Defaults flag at ≥ 2% (warning) / ≥ 5% (quarantine). Prefer `signals.flakyTier` - the server already classifies using the active config.
- **`report compare` and `report brief` take UUID `reportId`s, not `#479`-style displayNumbers.** Use `report resolve 479` to convert. `compare` also accepts the keywords `latest` / `prev`.
- **`report brief` is discriminated by `mode`.** `mode: 'summary'` carries `sampleUnclusteredFailures`; `mode: 'full'` (from `--with-failures`) carries `failedTests` instead. Full mode on a 50-failure report is ~100 KB - use sparingly.
- **`--failure-category` values are heuristic-emitted strings.** Run `category list` first for exact spellings. The same vocabulary appears as `latestFailure.category`, `cluster.category`, and the `failureCategory` query param.
- **`pwrs-cli attachment <url>` is HEAD-by-default.** It returns `{ url, status, contentType, bytes }` only. The URL is the answer in ~95% of cases - don't fetch the body unless the agent must read it. Pass `--inline` to add `encoding: "utf8" | "base64"` and `content`.
- **`outcome` vocabulary**: `test history` runs and `report brief.stats` use the normalized values `passed | failed | flaky | skipped`. (Raw `expected` / `unexpected` are mapped server-side.)
- **Pagination**: every list-returning command carries `total` + `hasMore`. When `hasMore: true`, pass `--offset` (where supported) or raise `--limit`.
- **Errors are JSON on stderr**: failed calls emit `{"success": false, "error": "…", "kind": "http|config|unknown", …}` and exit non-zero. Parse both stdout and stderr.

## Date filters

All time-windowed commands take `--from` / `--to` as ISO dates (`YYYY-MM-DD` or full ISO timestamp). For relative ranges, compute the dates yourself - **there is no `--since` flag**.

## Sanity check

```bash
pwrs-cli ping
```
Returns `{ ok, server, tokenConfigured, latencyMs, … }`. Use this when a command unexpectedly fails to distinguish config issues from real query failures.

## Loading the other docs

- **`setup.md`** - one-time setup (server URL, API token, default project). Load only if the user asks about configuring `pwrs-cli`.
- **`authoring.md`** - write commands (`analysis-submit`, `summary-submit`, `feedback`). Load only when the user explicitly asks you to author an analysis, submit a summary, or dissent on an existing one. Never overwrite a persisted analysis without that explicit ask.

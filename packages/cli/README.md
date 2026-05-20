# pwrs-cli

Read-only CLI exposing Playwright Reports Server data to coding agents (Claude Code, Codex, GitHub Copilot, etc.). Outputs compact JSON tuned for agent context budgets.

> Status: WIP — runs locally from the monorepo only. Not yet published to npm.

## Install (local, from the monorepo)

```bash
pnpm install
pnpm --filter pwrs-cli run build
node packages/cli/dist/bin.js --help
```

(`pnpm --filter pwrs-cli exec pwrs-cli` doesn't work — `pnpm exec` only looks in
`node_modules/.bin/`, and the workspace package's own bin isn't symlinked there.
Use `node dist/bin.js` directly, or symlink it onto your `$PATH` — see the
"Install the Claude Code skill locally" section in the root readme.)

## Configure

```bash
pwrs-cli config set server https://reports.example.com
pwrs-cli config set token <api-token>   # omit if the server runs without API_TOKEN
```

Equivalent env vars (override the saved config):

- `PRS_SERVER_URL`
- `PRS_API_TOKEN`

Saved to `~/.config/pwrs-cli/config.json`. Tokens are masked in `config get` output. The CLI sends `Authorization: Bearer <token>` — the same scheme the reporter package uses.

## Commands

Drill-down (you have an ID):

```
pwrs-cli test find <query>                    Resolve a test name → testId
pwrs-cli test from-file <path>[:line]         Resolve a spec file → testIds
pwrs-cli test brief <testId>                  Everything we know about this test (one call)
pwrs-cli report latest                        Latest report's brief
pwrs-cli report brief <reportId>              Specific report's brief
```

Discovery (no ID yet):

```
pwrs-cli project list                         List known projects
pwrs-cli tag list [--project <p>]             List report tags
pwrs-cli report list [filters]                Filtered report list (project, --from/--to, --pass-rate, …)
pwrs-cli report compare <a> <b> [--limit N]   Diff two reports (newly failed / fixed / …)
pwrs-cli test search [filters]                Search tests by tier / status / category / sort / window
pwrs-cli stats [filters]                      Aggregate health + trend deltas for a window
pwrs-cli cluster list [filters]               Active failure clusters across recent reports
```

Config:

```
pwrs-cli config set <server|token> <value>    Persist config
pwrs-cli config get [<key>]                   Show config (token masked)
```

All commands return JSON on stdout. Date filters use `--from YYYY-MM-DD` and
`--to YYYY-MM-DD` (or full ISO timestamps) — there is no `--since` flag.

## The two "brief" payloads

`test brief` and `report brief` are the main entry points. Each is one HTTP call that the backend composes server-side from:

- Test detail (quarantine state, flakiness, recent runs)
- LLM analysis (`/api/test/.../analysis`) — pre-computed root cause + fix
- Team feedback (`/api/llm/feedback`) — human notes pinned to a test
- Failure history (`/api/llm/test-history`) — when this signature first appeared
- Failure clusters (`/api/analytics/failure-clusters`) — which tests share a root cause

### `test brief` shape

```jsonc
{
  "testId": "…", "fileId": "…", "project": "…", "title": "…", "filePath": "…",
  "signals": {
    "quarantined": false,
    "flakinessScore": 0.7,           // %, > 5 worth flagging
    "occurrenceCount": 1,            // this signature's prior count
    "firstSeen": "2026-05-18T…",     // when this signature first appeared
    "isClustered": true
  },
  "latestFailure": {
    "error": "Error: expect(locator).toBeVisible() failed\n\nLocator: …\nTimeout: 15000ms\n…",
    "category": "element_not_visible",
    "signature": "n4jnay",
    "location": { "file": "e2e/create_doc.ts", "line": 322, "column": 9 },
    "appFrame": "src/pages/doc-editor/components/canvas.ts:32",
    "reportId": "…", "reportUrl": "/api/serve/…/index.html",
    "createdAt": "2026-05-18T…",
    "attachments": {                       // null if the run has none
      "screenshotUrl": "/api/serve/<reportId>/data/<hash>.png",
      "errorContextUrl": "/api/serve/<reportId>/data/<hash>.md"
    }
  },
  "llmAnalysis": {                   // null if no pre-computed analysis
    "rootCause": "…",                // full text
    "fix": "…",
    "model": "claude-…"
  },
  "feedback": {                      // null if no team note
    "comment": "Flaky in CI — see #INC-1234",
    "updatedAt": "…"
  },
  "cluster": {                       // null if not clustered
    "id": "…", "strategy": "signature", "name": "…",
    "sampleError": "…",
    "otherTests": [{ "testId": "…", "fileId": "…", "project": "…", "title": "…" }]
  }
}
```

### `report brief` shape

Same payload as `test brief` for each failed test, plus a top-level **clusterSummary** that rolls up which failures share a root cause — so an agent iterating over a 25-failure report fixes 2-3 clusters instead of 25 individual tests.

```jsonc
{
  "reportId": "…", "displayNumber": 479, "title": "…", "project": "…",
  "createdAt": "…", "reportUrl": "…",
  "stats": { "total": 128, "passed": 117, "failed": 0, "flaky": 1, "skipped": 10 },
  "clusterSummary": [
    {
      "id": "…", "strategy": "signature", "name": "…",
      "sampleError": "…",                  // full Playwright error message
      "testCount": 12,                     // 12 of 25 failures share root cause
      "testIds": ["…", "…"]
    }
  ],
  "unclusteredFailures": 10,
  "failedTestsTruncated": false,           // true when more than 50 failed
  "failedTests": [ <test brief>, <test brief>, … ]
}
```

## Usage examples

```bash
# Have a test name from CI output:
pwrs-cli test find "should redirect after login" --project chromium
pwrs-cli test brief <testId> --file-id <fileId> --project chromium

# Editing a spec file:
pwrs-cli test from-file tests/checkout.spec.ts
pwrs-cli test brief <testId> --file-id <fileId> --project chromium

# Triage what just ran:
pwrs-cli report latest --project chromium

# Have a reportId from CI:
pwrs-cli report brief <reportId>

# "What's flaky this week?"
pwrs-cli test search --tier flaky --from 2026-05-13 --to 2026-05-20

# "How's staging doing this week?"
pwrs-cli stats --project staging --from 2026-05-13 --to 2026-05-20

# "What reports failed today?"
pwrs-cli report list --pass-rate failing --from 2026-05-20 --to 2026-05-21

# "What clusters are active?"
pwrs-cli cluster list --project chromium --limit 5

# "What changed between these two runs?"
pwrs-cli report compare <reportIdA> <reportIdB>
```

## Context discipline

Briefs pass through error messages, LLM analysis, and cluster members verbatim — debugging is the use case, so the agent sees the full context the server has.

The one hard cap is the per-report failed-test list:

- `report brief` caps at 50 failed tests with a `failedTestsTruncated` flag so a 500-failure run can't pull the entire report into the agent.
- `test find` / `test from-file` default to `--limit 10` / `--limit 5` (override with `--limit N`).

`latestFailure.appFrame` is the first non-Playwright stack frame, normalized to `"path:line"` — Playwright internals and `node_modules` are filtered server-side, so no `--with-stack` flag is needed.

## Claude Code skill

The `packages/skill` workspace ships a `SKILL.md` + `plugin.json` for Claude Code. See the root `readme.md` ("Code assistant integration as skill") for install instructions.

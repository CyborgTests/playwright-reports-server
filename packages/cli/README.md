# pwrs-cli

Read-only CLI exposing Playwright Reports Server data to coding agents (Claude Code, Codex, GitHub Copilot, etc.). Outputs compact JSON tuned for agent context budgets.

Published on npm as [`@shelex/pwrs-cli`](https://www.npmjs.com/package/@shelex/pwrs-cli). The installed binary is `pwrs-cli`.

**Zero runtime dependencies.** Uses Node 20+ built-ins only.  

## Install

```bash
npm install -g @shelex/pwrs-cli
pwrs-cli --help
```

Or use without installing globally:

```bash
npx --package=@shelex/pwrs-cli pwrs-cli --help
```

### From source (contributors)

```bash
pnpm install
pnpm --filter pwrs-cli run build
node packages/cli/dist/bin.js --help
```

For Claude Code skill integration in a dev checkout, symlink the local build onto your `$PATH` so the skill's `Bash(pwrs-cli *)` permission resolves it:

```bash
sudo ln -sf "$(pwd)/packages/cli/dist/bin.js" /usr/local/bin/pwrs-cli
```

## Configure

```bash
pwrs-cli config set server https://reports.example.com
pwrs-cli config set token <api-token>   # omit if the server runs without API_TOKEN
```

Equivalent env vars (override the saved config):

- `PWRS_SERVER_URL`
- `PWRS_API_TOKEN`

Saved to `~/.config/pwrs-cli/config.json`. Tokens are masked in `config get` output. The CLI sends `Authorization: Bearer <token>` — the same scheme the reporter package uses.

## Commands

Drill-down (you have an ID):

```
pwrs-cli test find <query>                    Resolve a test name → testId
pwrs-cli test from-file <path>[:line]         Resolve a spec file → testIds (line narrows by proximity)
pwrs-cli test brief <testId>                  Everything we know about this test (one call)
pwrs-cli test analysis <testId>               Full persisted LLM analysis markdown
pwrs-cli test analysis-prompt <testId> --report-id <id>
                                              Verbatim prompt+response from the latest completed analysis task
pwrs-cli test failure-context <testId> --report-id <id>
                                              Fresh would-be prompt + typed evidence envelope (no LLM call)
pwrs-cli test history <testId> [--limit N]    Per-run history + signature rollup (default 20, max 50)
pwrs-cli report latest [--with-failures]      Latest report's brief (compact by default)
pwrs-cli report brief <reportId> [--with-failures]  Specific report's brief (compact by default)
pwrs-cli report summary <reportId>            Persisted LLM failure summary for a report
pwrs-cli report resolve <displayNumber>       Resolve a #479-style number to UUID reportId(s)
pwrs-cli cluster brief <clusterId>            Drill into one cluster: brief per member test
pwrs-cli attachment <url>                     Fetch screenshot/error-context/report with Bearer auth
```

Discovery (no ID yet):

```
pwrs-cli project list                         List known projects
pwrs-cli project summary [--project <p>]      Persisted LLM project health summary
pwrs-cli tag list [--project <p>]             List report tags
pwrs-cli category list [--project <p>]        List failure categories (for --failure-category)
pwrs-cli report list [filters]                Filtered report list (project, --from/--to, --pass-rate, …)
pwrs-cli report compare <a|latest|prev> <b|latest|prev> [--limit N]
                                              Diff two reports (accepts `latest` / `prev` keywords)
pwrs-cli test search [filters]                Search tests by tier / status / category / sort / window
pwrs-cli stats [filters]                      Aggregate health + trend deltas for a window
pwrs-cli cluster list [filters]               Active failure clusters across recent reports
```

Config and introspection:

```
pwrs-cli config set <server|token> <value>    Persist config
pwrs-cli config get [<key>]                   Show config (token always masked)
pwrs-cli ping                                 Sanity-check the server is reachable
pwrs-cli --version                            Print CLI version
pwrs-cli help <command>                       Per-command usage (e.g. `help test`)
```

Environment overrides (always win over saved config):

```
PWRS_SERVER_URL    Server URL
PWRS_API_TOKEN     API token
PWRS_PROJECT       Default --project for every command (explicit --project still wins)
```

All commands return JSON on stdout. Errors are JSON on stderr in the shape
`{"success":false,"error":"…","kind":"http|config|unknown",…}` with a non-zero
exit code. Date filters use `--from YYYY-MM-DD` and `--to YYYY-MM-DD` (or full
ISO timestamps) — there is no `--since` flag.

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
    "flakinessScore": 12.5,                // percent in [0, 100]
    "flakyTier": "critical",               // backend-derived: 'stable' | 'flaky' | 'critical'
    "signatureOccurrenceCount": 6,         // prior runs sharing latestFailure.signature
    "signatureFirstSeen": "2026-05-18T…"   // when *this signature* first appeared (not the test)
  },
  // To check cluster membership, read `cluster` (null when not clustered).
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

`screenshotUrl`, `errorContextUrl`, and `reportUrl` are server-relative paths. To fetch them via `WebFetch`, prepend `$PWRS_SERVER_URL` and send `Authorization: Bearer $PWRS_API_TOKEN`.

### `report brief` shape

`report brief` returns a discriminated union keyed on `mode`. Summary mode
(default) is ~5 KB; full mode (from `--with-failures`) is ~100 KB for a
50-failure report and includes a `TestBrief` per failure.

```jsonc
// Summary mode (default) — has `sampleUnclusteredFailures`, no `failedTests`
{
  "mode": "summary",
  "reportId": "…", "displayNumber": 479, "title": "…", "project": "…",
  "createdAt": "…", "reportUrl": "…",
  "stats": { "total": 128, "passed": 117, "failed": 0, "flaky": 1, "skipped": 10 },
  "clusterSummary": [
    {
      "id": "…", "strategy": "signature", "name": "…",
      "sampleError": "…",                  // full Playwright error message
      "testCount": 12,                     // 12 of 25 failures share root cause
      "testIds": ["…", "…"],
      "sampleFailedTests": [               // top 3 per cluster, always populated
        { "testId": "…", "title": "…", "category": "timeout", "errorFirstLine": "…" }
      ]
    }
  ],
  "unclusteredFailures": 10,
  "sampleUnclusteredFailures": [
    { "testId": "…", "title": "…", "category": "…", "errorFirstLine": "…" }
  ],
  "failedTestsTruncated": false            // true when more than 50 failed
}

// Full mode (--with-failures) — has `failedTests`, no `sampleUnclusteredFailures`
// `clusterSummary[].sampleFailedTests` is still present (cheap skim view).
{
  "mode": "full",
  // …everything from summary mode except `sampleUnclusteredFailures`…
  "failedTests": [ /* TestBrief, TestBrief, … */ ]
}
```

### `test history` shape

```jsonc
{
  "testId": "…", "fileId": "…", "project": "…", "title": "…", "filePath": "…",
  "totalReturned": 20, "hasMore": true,
  "stats": { "runs": 47, "passed": 35, "failed": 8, "flaky": 4, "skipped": 0 },
  "signatureGroups": [
    { "signature": "n4jnay", "category": "timeout", "count": 6,
      "firstSeen": "2026-05-12T…", "lastSeen": "2026-05-20T…" }
  ],
  "runs": [
    // outcome is one of: "passed" | "failed" | "flaky" | "skipped"
    { "reportId": "…", "reportDisplayNumber": 479, "outcome": "failed",
      "durationMs": 15203, "errorSignature": "n4jnay", "category": "timeout",
      "createdAt": "2026-05-20T…" }
  ]
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

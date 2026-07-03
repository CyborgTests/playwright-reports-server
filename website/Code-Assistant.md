# Code assistant

Give a coding agent (Claude Code, Mistral Vibe, Codex, Cursor, Continue, Copilot Chat, other "harness" that is shipping next week) access to your reports data. Instead of inventing what went wrong, the agent has access to test history, LLM analyses, your feedback, and failure clusters from the server.

Two pieces responsible for this:

- **[`@cyborgtests/pwrs-cli`](https://www.npmjs.com/package/@cyborgtests/pwrs-cli)**: a tiny CLI. Zero runtime dependencies. JSON in, JSON out.
- **`playwright-reports` Claude Code skill** (`packages/skill/`): a plugin plus a `SKILL.md` that tells Claude Code when to call the CLI and how to read what comes back.

> ask your agent "*why is login test failing?*", "*what's flaky this week?*", "*what is the current state of the test project qa:main*" and it fetches the relevant context, and comes back with an answer based on the actual data.

---

## Step 1: install the CLI

```bash
npm install -g @cyborgtests/pwrs-cli
pwrs-cli --help
```

Point it at your server:

```bash
pwrs-cli config set server https://reports.example.com
pwrs-cli config set token <api-token>   # skip if the server runs without API_TOKEN
```

**Env vars override the saved config** (handy for debugging):

| Var | What |
|-----|------|
| `PWRS_SERVER_URL` | Server URL |
| `PWRS_API_TOKEN` | API token |
| `PWRS_PROJECT` | Default `--project` for every command (explicit `--project` still wins) |

---

## Step 2a: wire it into Claude Code

```
/plugin marketplace add cyborgtests/playwright-reports-server
/plugin install playwright-reports
```

That's it. The `playwright-reports` skill is now registered.

Now ask Claude Code things like:

> *"why is `X` test failing?"*
> *"what's flaky this week?"*
> *"triage the latest report"*
> *"compare the last two reports for the `e2e` project"*

The skill fetches context and answers. If your model is being stubborn about picking it up automatically, ask explicitly: *"using the playwright-reports skill, find what failed in the latest report"*. Works on the most reluctant llms.

Want to build it from source locally?

```
/plugin marketplace add /path/to/playwright-reports-server
/plugin install playwright-reports
```

And symlink the local CLI build onto `$PATH`:

```bash
pnpm install
pnpm --filter pwrs-cli run build
sudo ln -sf "$(pwd)/packages/cli/dist/bin.js" /usr/local/bin/pwrs-cli
```

---

## Step 2b: wire it into Codex / Cursor / Continue / anything else

The CLI is just JSON-over-stdout. Any agent that can shell out can use it. Two options:

1. **Drop the SKILL.md into your assistant's rules.** Copy [`packages/skill/skills/playwright-reports/SKILL.md`](https://github.com/CyborgTests/playwright-reports-server/blob/main/packages/skill/skills/playwright-reports/SKILL.md) into:
   - Codex CLI: `AGENTS.md`
   - Cursor: `.cursor/rules`
   - Continue: `config.json` system prompt
   - GitHub Copilot Chat: workspace instructions

   The SKILL.md is portable text. It explains *when* to call `pwrs-cli` and *what* to expect in the output.

2. **Tell the agent the CLI exists.** With `pwrs-cli` on `$PATH`, say: *"use `pwrs-cli` to fetch Playwright report data when debugging tests. Run `pwrs-cli help` first to discover commands."* Most modern agents would understand.

---

## What the agent can ask for

The full command reference lives in [`packages/cli/README.md`](https://github.com/CyborgTests/playwright-reports-server/blob/main/packages/cli/README.md). The shape that matters when you're sizing your context budget:

**Drill-down (you already have an ID).** One call per entity:

```
test brief <testId>                              one-call context for one test
test analysis <testId>                           full persisted LLM markdown
test analysis-prompt <testId> --report-id <id>   the exact prompt+response we sent last
test failure-context <testId> --report-id <id>   evidence envelope, no LLM call
test history <testId> [--limit N]                per-run history + signature rollup
test find <query>                                resolve test name -> testId
test from-file <path>[:line]                     resolve spec file -> testIds
report latest [--with-failures]                  latest report brief
report brief <reportId> [--with-failures]        specific report brief
report summary <reportId>                        LLM failure summary for a report
report resolve <displayNumber>                   resolve #479 -> UUID
cluster brief <clusterId>                        drill into one failure cluster
attachment <url>                                 fetch screenshot/error-context with auth
```

**Discovery (you don't have an ID yet):**

```
project list                                     list known projects
project summary [--project P]                    LLM project health digest
report list [filters]                            filtered reports
report compare <a|latest|prev> <b|latest|prev>   diff two reports
test search [filters]                            search across tests
stats [filters]                                  aggregate health + trend deltas
cluster list [filters]                           active failure clusters
tag list / category list                         enums for filters
```

**Config:**

```
config set <server|token> <value>                persist config
config get [<key>]                               show config (token masked)
ping                                             sanity-check
--version                                        CLI version
```

### The two "brief" payloads worth knowing

`test brief` and `report brief` stitch together test detail, LLM analysis, team feedback, failure history, and failure clusters.  

---

## Date filters

ISO dates (`YYYY-MM-DD`) or full ISO timestamps. Always **explicit ranges**:

```bash
pwrs-cli test search --tier flaky --from 2026-05-13 --to 2026-05-20
pwrs-cli report list --pass-rate failing --from 2026-05-20 --to 2026-05-21
```

---

## Output and errors

Every command prints JSON to stdout. Errors go to stderr in the shape `{ "success": false, "error": "...", "kind": "http|config|unknown" }` with a non-zero exit code. Lists include pagination (`total`, `hasMore`, `limit`, `offset`).

Briefs are compact by default. Escalate with `--with-failures` when you actually need full details.

## See also

- [LLM analysis](./LLM-Analysis): the source of the analyses the CLI returns
- [LLM routing](./LLM-Routing): how those analyses can be produced by several models (fusion, council, cascade, refine)

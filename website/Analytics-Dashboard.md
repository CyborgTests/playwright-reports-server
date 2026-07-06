# Analytics dashboard

The dashboard where you check on the health of one project, or all of them, over whatever date range you care.

## What you can find there

### Stats

- Total runs, total tests, overall pass rate.
- Average test duration and p95.
- Slowest steps.
- Trend arrows comparing the selected window to the same-length window immediately before it. Up is good, down is the sign to do something.

### Run health grid

A tile per report with pass / fail / flaky / skipped counts, duration, title, and display number. Capped at the 200 most recent reports when no date filter is set, unbounded inside a date range.

### Trends over time

- **Duration trend**: total run duration by date.
- **Flaky count trend**: flaky outcomes per report by date.
- **Slow count trend**: tests exceeding the suite's dynamic p95 baseline per report.
- **Health trend**: pass-rate over time by date.

### Tests summary

Total unique tests in scope, count of tests above the warning threshold ("Critical" and "Flaky" tiers), and a period-over-period comparison.

### Failure categories

The top 10 categories with counts and percentages, each one expandable to the sample errors and affected tests. **Most Common Failures** card has the top 5 patterns with category badges.

### LLM failure analysis (project-level)

If LLM is configured, there's a **Generate Analysis** button that streams a synthesis across the latest reports. With auto-analysis on, this runs in the background after each new report, so the card is usually already populated. See [LLM analysis -> Project-level analysis](./LLM-Analysis#project-level-analysis) for the cluster-first details.

## Failure clustering

Failures get grouped into clusters so the dashboard can tell you "one fix unblocks 12 tests". Each failed `test_run` is assigned to exactly one cluster - there is no merging, no temporal correlation, no per-strategy precedence to resolve. The cluster IS its anchor.

Every cluster has exactly one anchor, picked by priority:

| Kind | Anchor (what to fix) | When it fires |
|------|---------------------|---------------|
| `fixture` | A `beforeAll` / `beforeEach` / `afterAll` / `afterEach` hook in a specific file | The failure message identifies a hook phase. Highest priority - fixes here cascade to every dependent test. |
| `selector` | A normalized Playwright locator (UUID-shaped row ids stripped, positional refinements like `.first()`/`.nth(N)` removed) | The failure message contains an extractable locator. One aria-label rename can break N tests across files; this catches that. |
| `frame` | A specific `file:line` of app code | An app-code frame is extractable from the stack trace or the message-embedded codeframe. |
| `unmatched` | The test itself | No mechanism could be extracted. Repeated failures of the same test still group together under one card. |

Plus a **Playwright verb** (`toBeVisible`, `click`, `toMatch`, …) is part of every anchor except `unmatched`. Two tests failing at the same line with different verbs stay in separate clusters - the fixes are usually different.

### Confidence

Every cluster carries `high` / `medium` / `low` confidence - how reliably "one fix resolves all" holds:

| Confidence | Means |
|-----------|-------|
| `high` | Fixture cluster, OR ≥ 3 tests share the same frame/selector anchor |
| `medium` | 2 tests share an anchor, OR one test fails chronically (≥ 3 times) at the same anchor |
| `low` | Single-test single-failure, or `unmatched` |

### The cluster card

Single-test clusters are valid - a unique failure is still a fix anchor. The UI splits the list into two sections:

1. **Actionable clusters** (`fixture` / `selector` / `frame`), sorted by impact (failureCount × testCount). Read from the top.
2. **Unmatched failures**, listed below - each one is its own card, with the test title and a short symptom in the name.

If there are no actionable clusters the page either shows only unmatched entries or, when the date range has no failures at all, an empty state.

## Date filtering

Pick `from` and `to` at the top of the dashboard. The comparison window automatically becomes the same-length range immediately before yours, so trend arrows are the comparison to this equal previous period. "All time" mode splits at the midpoint to compute a baseline.

## See also

- [Test management & quarantine](./Test-Management): the flakiness algorithm behind the tier badges
- [LLM analysis](./LLM-Analysis): what powers the failure analysis card
- [Code assistant integration](./Code-Assistant): `pwrs-cli stats`, `cluster list`, `report summary` for agents

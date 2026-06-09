<!-- cspell:words pwrs unclustered quarantineable magistral -->

# pwrs-cli — authoring & dissent (load on explicit ask only)

This file is loaded **only** when the user explicitly asks you to author or submit an analysis/summary, or to dissent on an existing one. The default skill behavior is read-only; do not invoke any of these write commands proactively.

## Stop authoring if

- **`409 Conflict` on submit** → an analysis/summary already exists. Ask the user before passing `--force`; never overwrite silently.
- **You haven't read the evidence first.** Authoring without running `failure-context` / `report brief` / `stats` is worse than no analysis.
- **You're below "medium" confidence** in the root cause. Submit `--category investigate` + a one-line "needs human review" comment instead of a speculative full analysis.
- **The user hasn't approved a dissent.** Always ask before posting `test feedback` — feedback is permanent and visible on the dashboard.

## Decision rule

| Existing state | What to do |
| --- | --- |
| `llmAnalysis: null` on a failing run | **Author**: pull `failure-context`, reason from evidence, write markdown, submit via `analysis-submit`. |
| `llmAnalysis` present, you agree | Do nothing — that's the read-only happy path. |
| `llmAnalysis` present, you believe it's wrong | **Dissent via feedback**: ask the user, then on `yes` run `test feedback`. Never overwrite the persisted analysis. |
| Report/project summary missing | **Author** via `report summary-submit` / `project summary-submit`. |
| Report/project summary present, you disagree | Ask the user; on `yes` re-submit with `--force`. There is no separate feedback channel at these levels. |

## 1. Authoring a missing test analysis

```bash
pwrs-cli test failure-context <testId> --report-id <reportId>
```

Reason from the `evidence` envelope (codeframe, step tree, ARIA snapshot, console/network/action logs, git/CI). Write the result to a temp file as markdown with at least these sections:

```markdown
## Root cause
<one paragraph>

## Fix
<concrete change — file path + what to edit, or "investigate X" if uncertain>

## Confidence
high | medium | low — with one sentence of why
```

Submit:

```bash
pwrs-cli test analysis-submit <testId> \
    --report-id <reportId> \
    --analysis-file /tmp/analysis.md \
    --model <your-model-id>     # e.g. claude-opus-4-7
    [--category <c>]            # optional; from `pwrs-cli category list`
```

Pass `--analysis-file -` to read from stdin instead of a file.

On `409 Conflict`, an analysis already exists — switch to the dissent flow. Do not pass `--force` unless the user has explicitly approved overwriting.

## 2. Dissenting on an existing analysis

Before dissenting, read what the prior LLM saw so you can tell whether the mistake was bad reasoning vs. missing context:

```bash
pwrs-cli test analysis-prompt <testId> --report-id <reportId>
```

If you're still confident the persisted analysis is wrong, **ask the user**:

> The persisted analysis says **X**. From the evidence I think **Y** because **Z**. Submit this as feedback?

On `yes`:

```bash
pwrs-cli test feedback <testId> \
    --comment "Disagree — <terse dissent + corrected hypothesis>" \
    --report-id <reportId>
```

Keep the comment under ~1 KB. Lead with the disagreement, then the corrected hypothesis. The CLI stores it via `PUT /api/llm/feedback` and the dashboard surfaces it above the LLM analysis automatically.

Clear with:

```bash
pwrs-cli test feedback-clear <testId> --report-id <reportId>
```

## 3. Authoring a report-level failure summary

```bash
pwrs-cli report brief <reportId> --with-failures   # gather context first
# author the summary to a temp file…
pwrs-cli report summary-submit <reportId> \
    --summary-file /tmp/report-summary.md \
    --model <your-model-id> \
    [--structured-file /tmp/report-structured.json]   # optional
```

The optional `--structured-file` carries `ReportAnalysisStructured` JSON:

```json
{
  "verdict": "isolated | clustered | widespread | systemic",
  "summary": "1–3 sentence executive summary",
  "sections": [
    {
      "heading": "…",
      "body": "markdown",
      "impact": "high | medium | low",
      "codeRefs": [{"kind": "test", "label": "…", "testId": "…"}]
    }
  ]
}
```

When present, the dashboard renders the verdict pill above the prose.

`409` → a summary already exists. Ask the user; on `yes` re-run with `--force`.

## 4. Authoring a project-level health digest

```bash
pwrs-cli project summary [--project <p>]              # check the existing one first
pwrs-cli stats --project <p> --from <ISO> --to <ISO>  # gather context
pwrs-cli project summary-submit \
    [--project <p>] \
    --summary-file /tmp/project-summary.md \
    --model <your-model-id> \
    [--structured-file /tmp/project-structured.json] \
    [--last-report-id <id>] [--report-count N] \
    [--first-report-at <ISO>] [--last-report-at <ISO>]
```

`--project` defaults to `all` (cross-project digest), matching read-side semantics.

Structured JSON shape (`ProjectAnalysisStructured`):

```json
{
  "verdict": "healthy | stabilizing | degrading | failing",
  "summary": "1–3 sentence executive summary",
  "sections": [
    {
      "heading": "…",
      "body": "markdown",
      "codeRefs": [{"kind": "test", "label": "…", "testId": "…", "reportId": "…"}]
    }
  ],
  "latestReportId": "…"
}
```

`409` → existing digest present. Ask the user; on `yes` re-run with `--force`.

## Guardrails

- **Always read before authoring.** `failure-context` for tests; `report brief` for reports; `stats` + `project summary` for projects.
- **Never silently overwrite.** `409` is the system telling you "a human or another LLM already decided" — escalate to the user, never to `--force`.
- **`--model` is the model that wrote the analysis** (e.g. `magistral-small`), not a project label. The dashboard surfaces this so reviewers know what authored each cell.
- **Feedback is dissent, not retry.** If the user wants a fresh LLM-authored analysis, point them at "Re-analyze" in the dashboard. Author only when no LLM analysis exists.

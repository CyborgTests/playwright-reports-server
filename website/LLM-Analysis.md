# Analysis

Failure analysis is optional and **off by default**. Configure a provider in `Settings -> LLM Configuration` and it lights up in:

- The "Ask LLM" button injected into every served Playwright report
- The Failure Summary card on each report's detail page
- The Failure Categories chart and project-level summary on the Analytics dashboard

## Providers

Two API formats. Pick whichever matches the token you're holding:

- **Anthropic**: `https://api.anthropic.com/v1` (or a drop-in clone), auth via `x-api-key`. Uses the messages API with prompt caching. !NB - openRouter with opus or sonnet is still not an `anthropic` api format.  
- **OpenAI-compatible**: any base URL implementing `/chat/completions` and `/models` with `Authorization: Bearer <key>`. That covers OpenAI itself, Azure OpenAI, OpenRouter, Groq, Together, Ollama, LM Studio, oMLX, vLLM, llama.cpp servers, and the long tail of "we promise to be cheaper" providers.

> "Provider" here means the **API format**, not the brand on the payment check, e.g. if you're gambling tokens with OpenRouter - pick OpenAI-compatible;

## The model registry

In `Settings -> LLM Configuration -> Models`:

1. **Add a model** - label, provider (format), base URL, key, plus its own concurrency, temperatures, context window, multimodal mode, and optional cost rates (so the queue can estimate the damage to budget).
2. **Test connection**, so you find out it's misconfigured now and not later.
3. **Enable** it.
4. Mark exactly one as **Primary** - the model that does single-call analysis and stands in for any routing role you have not assigned.

The **Enable LLM features** checkbox in the header stays greyed out until a Primary exists, because a feature with no model to call is just a button that lies.

### Bulk-import & discovery

Adding models one by one gets old fast when a provider serves dozens. **Import models** (in the Models section) lists a provider's catalog and adds several at once: enter the provider format, base URL, and key, and the server queries the provider (the same `/models` listing it probes for context windows). Pick the ones you want and import them in one go - **context window and input/output cost rates are pre-filled** from the provider's metadata when it exposes them (e.g. OpenRouter pricing), so you don't hand-copy numbers. Imported models land disabled; enable and pick a Primary as usual.

Optionally flip **Use fallback chain**: when a call fails, the next enabled model catches it (the Primary stays primary).

**Concurrency groups** (optional). Each model has its own *Parallel requests*, but when several models are backed by the **same hardware** - e.g. two endpoints (or two models) served off one local GPU - counting their slots separately oversubscribes that hardware. Create a concurrency group and assign those models to it: the **group's limit is one shared budget** across all its members, so the queue runs that many calls at a time *across the group*, not per model. A model not in any group keeps using its own *Parallel requests*.

More than one model unlocks **routing** - running a task through several models (fusion, council, cascade, refine) instead of trusting one. See [LLM routing](./LLM-Routing). Every task defaults to **One-shot** (just the Primary).

## Tested models

[LLM selection](./LLM-Selection) covers how to choose what you plug in - what makes a model work well here, and what to reach for locally vs remotely.

Two things make a model "reliable" for this app:

1. **It follows markdown structure prompts.** Models that wander off-format produce output quite hard to read (and parse).
2. **It supports image input** if you want screenshots fed to it directly. The server `auto-detects image support` and falls back to text-only when the model gets offended. (Or point a dedicated **vision model** at screenshot parsing - then a text-only analysis model still gets the screenshots, transcribed to text. See [Screenshots & vision input](#screenshots--vision-input-test-analysis).)

## Per-task temperatures

Three tasks, three temperatures - set **per model**. Defaults below.

| Task | Default | What it does |
|------|---------|--------------|
| `testAnalysis` | `0.2` | Per-failed-test root cause and category. Cool, because classification accuracy matters. |
| `reportSummary` | `0.3` | Report-level synthesis (one card per report). |
| `projectSummary` | `0.3` | Cross-report narrative for a project. |

If you want shakespearean prose, bump to 0.6 to 0.8. The defaults are low on purpose: you better get the same failure to get the same category twice in a row, 3 times is even better. However, for smaller models setting lower temperature may produce unescapable reasoning loops, so it makes sense to keep it at 0.6-0.7 range.  

## Screenshots & vision input (test analysis)

Configured per project in `Settings -> LLM Configuration -> Routing -> Test analysis`.

**1. Sources**:

- **Failure screenshot** - the test's screenshot attachment (the default).
- **Before & after failed action (trace)** - the two screencast frames bracketing the failing action, pulled from the Playwright trace, labelled with their timing.
- **Series of trace frames** - a sampled series across the run. Near-identical frames are dropped via a perceptual hash (a stuck spinner collapses to single frame, not twenty), so LLM gets the *distinct* states with timecodes.

**Max screenshots** caps the total (default `3`, ceiling `10`); when the deduplicated set is over budget the least-meaningful frames are dropped first, but the frame near the failure and the initial state are always kept. Trace sources need trace recording (`trace: 'on'` / `'on-first-retry'`); with no trace they just fall back to the single failure screenshot.

**2. Vision model** (optional). Pick a dedicated, vision-capable model and it **transcribes the screenshot(s) to text** before analysis - so the analysis model can be **text-only** and still get the visual signal ("blank page", "error toast", "spinner"). It runs first as a **Screenshot** child role on the test-analysis task (visible in the LLM Queue with its own model, frame count, tokens, and duration). Leave it off to send the raw image inline instead (subject to the multimodal auto/force/disabled behavior below). The transcription prompt is editable under `Prompts -> Routing role prompts -> Screenshot`.

## The background queue

LLM work runs through a queue.

- **Concurrency:** set **per model** (each model's *Parallel requests*, default `1`). Set this only after confirming it tolerates more than one in flight. Most competent local models don't unless you have a lot of RAM. Models that share hardware can be put in a **concurrency group**, whose single limit is the shared budget across all its members (so two endpoints behind one GPU run one call at a time, not one each).
- **Polling:** the queue picks up new tasks every 5 seconds.
- **Auto-analyze:** if `Auto-analyze new reports` is on, every fresh failed test, report summary, and project summary is enqueued the moment a report uploads.
- **Auto project summary:** project-level analysis re-runs after each new report, so the dashboard's summary stays current without you remembering to click it.
- **Retries:** 3 attempts per HTTP call with exponential backoff plus jitter, because retry storms are not good.
- **Reuse:** if a test fails again with the same error signature, the prior analysis is reused for free (zero tokens, can you believe it). Reuse is **skipped** when (a) you clicked Retry, (b) feedback was added after the analysis, (c) the source analysis is older than 7 days, or (d) the same signature has recurred more than 5 times.

The **LLM Queue page** (Settings -> LLM Configuration -> "LLM Queue") shows tasks, per-model token usage, and an estimated **cost** per task - assuming you specified your model rates. A task with child calls expands (`▸`) into its per-role breakdown - model, status, tokens, duration, scorer score, per-role cost - so you can see exactly which model spent your money (multi-model [routing](./LLM-Routing) strategies, and the **Screenshot** vision pre-step on test analysis). And a **Reset counters** control for when you want the dashboard to start the math over (after switching models, or to pretend the casino bill never happened).

## Project-level analysis

Project summaries look at the **latest 20 reports** in a project. Not a time window: 20 reports could span a day or a quarter depending on CI frequency. The prior comparison window is the same-length batch immediately before that.

Project summaries are cluster-first: each failed run is anchored to a single fix target - a failing fixture hook, a Playwright locator, an app-code `file:line`, or (when nothing extractable) the test itself - and the LLM sees one cluster per anchor instead of N raw failures. Cluster IDs are deterministic, so the same cluster is trackable across windows when the trend block tells the model what's resolved, persisting, or new. This keeps the prompt small even on projects where the red suite is the default.

Reuse rules do **not** apply to project summaries. They're always recomputed, because that's the one place stale answers would actively mislead.

## Custom prompts

`Settings -> LLM Configuration -> Prompts` has two groups. **Task prompts** override the three task templates (system + instructions); **Routing role prompts** override the directives the multi-model strategies bark at each other (synthesizer, judge, critique, revise, scorer - see [LLM routing](./LLM-Routing)). Each task template supports `{{var}}` substitution with a per-template allowlist:

| Template | Allowed `{{vars}}` |
|----------|--------------------|
| `testAnalysis` | `project`, `testTitle`, `filePath`, `errorCategory` |
| `reportSummary` | `reportId`, `project`, `totalFailures` |
| `projectSummary` | `project`, `totalRuns`, `passingRuns` |

Unknown variables stay as literal `{{thing}}` with a warning.

> **Caching caveat:** Anthropic prompt caching applies to stable segments. If your custom prompt uses a lot of substitutions, that segment is marked unstable and skips the cache. Put the stable bulk of the prompt at the front; reserve `{{vars}}` for short, varying bits.

## The "Ask LLM" button (in-report)

Every served Playwright report gets an **Ask LLM** button injected next to the native "Copy prompt" button.

When clicked:

1. Ask backend to analyze the failure.
2. The server enqueues the task and returns a task ID.
3. The button streams progress via **SSE**. If your connection drops, hit Retry; there's no silent polling fallback.
4. The analysis renders inline above the error section, with links back to related runs and a **♻ Reused** badge when the answer came out of cache.

If LLM is disabled server-side, the button hides and only pre-computed analyses (if any) are visible.

### Feedback widget

Below each analysis, a **Feedback** panel lets you pin a short note to the test. The note flows into future analyses for that test, including across projects, weighted as high-priority context in the prompt. Use it for things the LLM can't infer from the error alone: "this dies behind the corporate proxy, ignore", "owner is Maria on the different team", "retry-then-cry is the valid workaround". The widget also shows:

- 🆕 new error vs prior occurrences
- 🔁 N prior occurrences of this signature
- 🔗 also seen in M other projects
- ♻ this analysis was reused from a previous run
- ⚠ feedback is newer than the displayed analysis (refresh to regenerate)

## Quirks worth knowing

### Quirk 1: image support is auto-detected and cached for an hour

With `Multimodal mode = auto` (default), the server attaches the failure screenshot to the prompt. The first time a model rejects images (with any of the usual "not supported / does not support / not a vision model" style errors), that exact `(provider, baseUrl, model)` combo is blocklisted for **1 hour** and retried text-only. Restart the server or wait it out to re-probe. Yes, this means if the provider quietly enables vision on a model mid-day, you won't notice until the cache expires. Worth it for not pelting them with rejected requests.

Use `force` if you only want vision-capable models. Use `disabled` to skip images entirely and save ~1200 tokens per call. To keep a non-vision analysis model *and* use screenshots, set a dedicated vision model for screenshot parsing (see [Screenshots & vision input](#screenshots--vision-input-test-analysis)) - it transcribes the image to text, so this auto/force/disabled probe doesn't apply.

### Quirk 2: context window is auto-detected, with cache

For OpenAI-compatible providers the server probes `/models` for `loaded_context_length` / `context_length` / `max_model_len` / `max_context_length` / `n_ctx` (each provider has its own preferred field name, because they can) and caches the result for 5 minutes. If your provider doesn't expose any of those, set **Context window override** in Settings. Manual override wins.

For Anthropic, context windows are hardcoded. Every current Claude model is 200k. The hardcoding is going to age either gracefully or hilariously.

### Quirk 3: token counting

- **Anthropic** uses the free `/messages/count_tokens` endpoint. Counts are exact.
- **OpenAI-compatible** estimates at 4 chars/token plus 1200 tokens per attached image. Expect ~10% drift. If you want exact, that's between you and your provider.

### Quirk 4: the queue is single-threaded by default

If LLM analysis feels slow on a report with 50 failures: that's 50 sequential calls at concurrency 1. You have three options. Bump a model's `Parallel requests` (if your provider doesn't block you because of rate-limits) or enable more models so the queue's combined concurrency rises (unless they're in the same **concurrency group**, which caps them to one shared budget), pick a faster model, or just be patient. Auto-analysis runs in the background, so the report is usable immediately.

## Disabling LLM

Turn off the **Enable LLM features** checkbox in the `LLM Configuration` header (the master switch). The integration goes dark, the Ask button disappears, the queue pauses, pre-computed analyses are still readable. Disabling every model or removing the Primary has the same effect.

## See also

- [LLM routing](./LLM-Routing): run a task through several models (fusion, council, cascade, refine) - pros/cons and how to experiment safely
- [LLM selection](./LLM-Selection): how to pick a model - what matters here, sampling settings, and local vs remote guidance
- [Code assistant integration](./Code-Assistant): `pwrs-cli` exposes the same analyses to coding agents at no extra token cost
- [Analytics dashboard](./Analytics-Dashboard): where failure categories and project summaries show up

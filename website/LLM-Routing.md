# Routing

Routing decides **how** each LLM task produces its answer: a single call, or several models orchestrated together. It's configured per task in `Settings -> LLM Configuration -> Routing`, on top of the model registry.

**TLDR**: **`One-shot` is the right default for almost everyone.** The multi-model strategies **could** be a real deal and **could** help, but they cost 2–5× the calls and only pay off under specific conditions.

## Prerequisite: the model registry

Routing orchestrates models from the registry, so first add them in `Settings -> LLM Configuration -> Models`:

- Add one or more models (each has its own base URL, key, per-task temperatures, parallel-requests, and optional cost rates).
- **Test connection**, then **enable** a model.
- Mark exactly one as **Primary** - that's the model `One-shot` uses and the default for any routing role you leave unset.
- Optionally turn on **Use fallback chain**: on a failing call, the request fails over to the next enabled model.

Fill in **Input/Output cost (USD / 1M tokens)** per model if you want to track approximate value you have spent gambling tokens.  

## Tasks

Routing is set independently for each:

| Task | What it produces |
|------|------------------|
| `Test analysis` | Per-failed-test root cause + category. Reasoning-heavy. Benefits from models capable in graphic-decoding. |
| `Report summary` | One synthesis card per report. Aggregation-heavy. |
| `Project summary` | Cross-report narrative for a project. Aggregation-heavy. |

If you want just to experiment - feel free to start with **Project summary** first. It runs less often than per-test or per-project (usually), really shows model reasoning and aggregation capabilities across your data.  

## Strategies

### One-shot (default)
One model produces the answer - the Primary by default. Optionally falls over to the chain.

You can also **pin a specific (non-Primary) model per task** with the model picker in that task's card - e.g. keep test analysis on the strong Primary while report/project summaries run on a cheaper model. A pinned model **bypasses the fallback chain** (you chose it on purpose); leave the picker on Primary to keep the default behavior.

- **Best for:** every task - test, report, and project. The default everywhere, and the only sensible choice for anything that runs often, unless you've measured a real win.
- **Pros:** cheapest, fastest, simplest. For hard reasoning, one strong model beats entire ensemble of smaller models.
- **Cons:** stronk models are costly.
- **Use when:** always, unless you have a concrete reason and a way to measure the difference.

### Cascade
Tries models cheapest -> strongest ([FrugalGPT](https://arxiv.org/abs/2305.05176)). Each non-final tier's draft is checked by a **gate**; only drafts that fail the gate escalate to the next tier. The escalation gate is configurable:

- **Checks + scorer** (default): deterministic checks first (empty / repetition loop, and for test analysis a valid `Category:` footer); a draft that passes is then rated 0–1 by a **scorer** model and escalates if it's below the threshold. The scorer is **boundary-aware** for test analysis - it's told the category traps (a correct 401/sign-in redirect is not `app_bug`; expired auth is `environment`), so a confident-but-wrong label is capped low and escalates.
- **Checks only**: escalate purely on the machine-detectable defects. No scorer call - the cheapest gate.
- **Scorer only**: skip the deterministic checks; escalate purely on the scorer's rating.
- **Disagreement**: a **second-opinion** model answers the same prompt; escalate only when its label differs from tier-1's. If the second opinion can't produce a parseable label, the gate **abstains** and falls back to the deterministic checks (it won't escalate on a non-answer).

- **Best for:** **test analysis**. It runs across many failures and most are easy, so handling the easy ones cheaply and escalating only the hard ones saves the most here.
- **Pros:** value proposition is **lower cost** - cheap model answers the easy majority, the expensive model is reserved for the hard minority. Can even beat a single strong model (a cheap model sometimes nails what the big one fumbles).
- **Cons:** the gate decides everything. With a weak tier-1 model on test analysis, the category check fails almost every time, so it always escalates and the scorer never runs (you pay for a scorer that does nothing - switch to *Scorer only* or use a stronger tier-1). A scorer that's no better than tier-1 tends to just approve whatever it sees. **The escalation tier should be a *different family*** - a bigger model from the same family usually repeats the same mistake. Worst case (every tier escalates) costs more than one-shot on the top model, so it makes sense to switch back to One-shot option.  
- **Use when:** you have a genuinely cheaper (but capable) tier-1 and an expensive, **different-family** top tier, and most inputs are quite easy.

### Fusion
Several **authors** draft the same task in parallel; a **synthesizer** merges them into one answer ([Mixture-of-Agents](https://arxiv.org/abs/2406.04692); the same-model variant is [self-MoA](https://arxiv.org/abs/2502.00674)).

Each author can carry a **lens** - a point of view to take (e.g. *assume the app is at fault* / *assume the test or environment is at fault* / *be a skeptic*). Lenses let one model look at the failure from different angles, so you get useful variety even without several different models.

- **Best for:** **report and project summaries** - combining a few takes helps these aggregation tasks. Also worth a try on genuinely hard, contested test-analysis cases.
- **Pros:** can lift quality by combining different takes and dropping contradictions. The synthesizer decides the final label from the evidence itself instead of just following whatever the authors agreed on, so a shared mistake doesn't carry through.
- **Cons:** only helps when the authors are **genuinely different** - different families, or at least different lenses. Identical authors with no lens share the same blind spots, so you pay several times over for what is effectively one answer. A weak author can drag the synthesis down.  
- **Use when:** you have 2–3 peer-quality, different-family models (or one capable model under contrasting lenses) and quality matters more than cost.

### Council
Several authors draft; **judges** score/vote; the best-voted draft wins ([panel of judges](https://arxiv.org/abs/2404.18796)). 

The most common judge-approach biases and how Council mitigates them:
- **Position bias** (judges tend to pick whichever candidate is shown *first*) -> every judge sees the candidates in its **own independent random order**, and each verdict is mapped back to the original draft before aggregating. Order can't advantage a draft.
- **Verbosity bias** (longer answers *look* more thorough) -> among candidates **statistically tied** at the top mean score (within a small epsilon), the **shortest** one wins.
- **Self-preference / model-family bias** (a judge over-rates drafts from its *own* model family) -> a judge's verdicts on its own model's draft are compared **separately** from foreign-judge verdicts, and seriously counted **only when no foreign judge scored that draft** - so a draft is never left unjudged, but a model can't vote itself up whenever an independent judge was available.

On top of these, the winner is decided by **majority vote across all judges** (configurable `min passing votes`, clamped to the judge count), which damps any single judge's preference. These mitigations may reduce bias, but they cannot totally erase it - **diverse judges still matter** (a panel of one model judging itself is quite a bad idea).

- **Best for:** the rare, high-stakes run where getting it right beats the cost - **project summary** above all. Usually too expensive for per-test analysis at volume; only worth it there if correctness clearly outweighs spend.
- **Pros:** strongest results on hard, checkable tasks; scales with the number of drafts.
- **Cons:** most expensive (authors + judges); Diversity matters as much as in fusion.
- **Use when:** project summary, test analysis potentially, with diverse authors *and* judges, if you care most about correctness over spend.

### Refine
One **author** drafts; a **critic** critiques it; a **reviser** rewrites - for N rounds ([Self-Refine](https://arxiv.org/abs/2303.17651)). Author, critic, and reviser can each be a different model (they default to the author). Two modes:

- **Revise** (default): the reviser edits the draft using the critique.
- **Escalate**: if the critic finds a real problem, the reviser **answers the original evidence from scratch** (it gets the critique as hints, but not the draft). This keeps a strong reviser from just following a weak draft instead of giving its own answer.

- **Best for:** **report and project summaries** - it polishes structure and coverage, which is what these write-ups need. For **test analysis**, only *escalate* mode really helps (let a strong model take over on flagged cases); plain revise rarely fixes a wrong root cause.
- **Pros:** improves generative quality (coverage, format adherence) without needing multiple peers; works with a single capable model. *Escalate* mode is the safer way to combine a cheap author with a strong reviser.
- **Cons:** ~2 calls per round on top of the draft; sequential, so it adds latency. Doesn't reliably fix *reasoning* errors with no external signal - it shines on summarization-shaped tasks, not pure deduction. A critic no stronger than the author rarely flags anything, so the revise/escalate step almost never fires and you just pay for the critique.
- **Use when:** report/project summaries where you want a tighter, better-structured write-up; or *escalate* mode when you want a strong model to take over only on flagged cases.

### Which strategy for which task (at a glance)

| Task | Natural fits | Why |
|------|--------------|-----|
| **Test analysis** | One-shot, Cascade | Runs across many failures, so saving cost on the easy ones matters most. Cascade escalates only the hard cases; Fusion/Council are usually too pricey at this volume. |
| **Report summary** | One-shot, Refine, Fusion | Aggregation task that runs rarely, so a heavier strategy is affordable when you want a cleaner, fuller write-up. |
| **Project summary** | One-shot, Refine, Fusion, Council | Runs least often and quality matters, so it's the one place the strongest (and priciest) strategies can pay off. |

One-shot stays the safe default for all three; the others are worth trying only where the table says they fit and you can measure the difference.

## Choosing models & roles (pros and cons)

Which model you put in each seat matters more than which strategy you pick.

### What to look at in a model

- **Family.** Models from different makers (Qwen, Mistral, Claude, Gemini) make different mistakes.
  - *Good:* when a second model from a different family checks or re-answers, it catches what the first one missed.
  - *Bad:* two models from the same family - even a bigger version of the same one - usually make the *same* mistake, so adding it costs money without adding accuracy. The simplest rule on this page: **different beats more of the same.**
- **Can it see images?** Test analysis depends a lot on the screenshot.
  - *Good:* a vision model can spot a broken screen (blank page, wrong page) that text alone won't show.
  - *Bad:* a text-only model can't use the screenshot directly - the image is stripped or the call fails. **But** you can set a dedicated **vision model for screenshot parsing** (see [LLM analysis -> Screenshots & vision input](./LLM-Analysis#screenshots--vision-input-test-analysis)) and it transcribes the screenshot to text the text-only model can parse.
- **Strong vs cheap.**
  - *Strong:* reliable, and the quality bar everything else has to beat.
  - *Cheap:* fast and well-formatted, but on the hard, unclear cases it is often **sure and wrong**, and may never land on some answers. Good as a first pass that something else checks - not on its own.
- **Does it answer in the required format?** Any model that *makes a decision* for the gate (scorer, judge, second opinion) has to reliably produce the category/verdict line.
  - *Good:* a model that always gives a clean label makes the accept/escalate choice mean something.
  - *Bad:* a model that often skips the label turns the gate into a coin flip - it reacts to a missing answer, not a real disagreement.
- **Temperature.** The category/verdict should come out the same each time.
  - *Good:* keep it low (about 0.2–0.3) so the label is steady and comparisons are trustworthy.
  - *Bad:* high temperature makes even a strong model give different answers on the same input, which hides any real difference between strategies.

### Who to put in each seat

- **Primary / one-shot** - your strongest reliable model. *Good:* simplest way to the best answer. *Bad:* cost. The default.
- **Cascade first tier (cheap drafter)** - fast and cheap, and able to see images for test analysis. *Good:* handles the easy cases cheaply. *Bad:* if it's too weak, everything escalates and you pay for both tiers.
- **Cascade fallback tier** - strong, and from a **different family** than the first tier. *Good:* actually fixes what the first tier got wrong. *Bad:* a same-family fallback repeats the same mistake.
- **Scorer** - stronger than, or different from, the first tier. *Good:* a stronger or different scorer catches real mistakes and sends them up. *Bad:* a scorer that's no better than the drafter just approves whatever it sees.
- **Second opinion (disagreement gate)** - cheap, different family, reliable label, can see images. *Good:* a cheap way to flag the cases worth escalating. *Bad:* if it can't give a clean label it adds nothing (the gate just falls back to the basic checks).
- **Fusion authors** - different families, or one model run under different lenses. *Good:* real differences between drafts are what's worth merging. *Bad:* identical authors with no lens are just a costly one-shot.
- **Synthesizer** - a strong model that decides from the evidence itself. *Good:* keeps the best parts of each draft. *Bad:* a weak one drags the result down.
- **Critic (refine)** - stronger than, or different from, the author. *Good:* it actually points out real problems, so the fix step runs. *Bad:* a critic no better than the author keeps saying "looks fine," and nothing happens.
- **Reviser (refine)** - in *escalate* mode, a strong model writing a fresh answer. *Good:* it isn't dragged along by the weak draft. *Bad:* in *revise* mode a strong reviser can follow the weak draft and drop its own, better answer.
- **Judge (council)** - several different models, never one model grading only itself. *Good:* a vote across families cancels out any single model's bias. *Bad:* one family judging itself is the worst case.

### In short

- **Do:** cheap (image-capable) drafter -> strong, different-family fallback; keep the label temperature low; put a *different family* in any seat that checks another model; use lenses to get different angles when you only have one good model.
- **Avoid:** escalating to the same family; text-only models for test analysis *unless* you've set a vision model for screenshot parsing; a checker no stronger than the model it checks; high temperature for the category/verdict; trusting a strategy difference before a low-noise, frontier-judged run confirms it.

## Cost reality

The cost note under each task tells you the call fan-out:

| Strategy | Calls (rough) |
|----------|---------------|
| One-shot | 1 |
| Cascade  | 1 per tier, + 1 scorer per escalation (0 in *Checks only*) |
| Refine   | 1 + ~2 per round |
| Fusion   | 1 per author + 1 synthesizer |
| Council  | 1 per author + 1 per judge |

Two things make the cost less scary than it looks:
- **Only input is multiplied.** Output tokens (the expensive half on a frontier model) are produced once per draft - so even aggressive strategies cap savings/overhead around a third of total cost, not 5×.
- **The evidence is benchmark-shaped, not domain-specific.** The research these strategies come from ([Mixture-of-Agents](https://arxiv.org/abs/2406.04692), [sample-and-vote / panel of judges](https://arxiv.org/abs/2404.18796), [FrugalGPT](https://arxiv.org/abs/2305.05176), [Self-Refine](https://arxiv.org/abs/2303.17651)) is measured on general benchmarks - not "explain a Playwright failure." Treat any quality claim as a hypothesis until you measure it on *your* reports.

A practical pattern that's almost always a win regardless: run the strategy on **cheap/local models** rather than a frontier model. A 3-author fusion on mid-tier models can cost a fraction of a single frontier one-shot.

## How to actually experiment (yay, empiric exploration!)

1. **Set up the registry:** add 2–3 models (mix providers/families if you'll try fusion/council), fill in cost rates, pick a Primary.
2. **Pick one task** and switch its strategy. Assign roles (authors/judges/tiers/critic/reviser) to specific models, or leave them on the Primary.
3. **Trigger a run** - upload a report, or retry existing analysis.
4. **Open `Settings -> LLM Configuration -> LLM Queue`** and expand the task (`▸`). The per-role breakdown shows every child call: role, model, status, tokens, etc., with the **total cost** rolled up on the parent row.
5. **Compare:** run the same report under `One-shot` and under your candidate strategy. Read both outputs; compare total cost and latency in the queue. Keep the one that's actually better for the buck or is good enough (the best is the enemy of good).
6. **Reset counters** (LLM Queue -> Reset counters) to start clean (or just do own math).

Tips:
- **diversity warning** on fusion/council is displayed not just to bring more yellow into dark lives - the reason is that same-model ensembles are just expensive one-shots.
- For cascade, watch whether a `Scorer` row actually appears. If it never does, the deterministic checks are short-circuiting it (see Cascade cons).
- Routing degrades safely: if a strategy's orchestration fails, the task falls back to one-shot on the Primary, and the queue marks it.

## Prompts

The directives the strategies use (synthesizer, judge, critique, revise, scorer) are editable under `Settings -> LLM Configuration -> Prompts -> Routing role prompts`. The per-task system/instruction prompts live under **Task prompts** in the same place. Each falls back to a sensible built-in.

## See also

- [LLM analysis](./LLM-Analysis): the tasks, the queue, reuse, per-model settings
- [LLM selection](./LLM-Selection): how to choose a model for single-shot
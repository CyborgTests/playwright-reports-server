# Model selection

Any specific model recommendation goes stale in a month, so this page sticks to how to
choose one for failure analysis and what to reach for locally versus remotely. Wire
whatever you land on into the [model registry](./LLM-Analysis#the-model-registry).

## What the app leans on

A model can be great at chat, tool-calling, or long agentic runs and still be a poor fit
here. Three things decide it.

Screenshots. Test analysis feeds failure screenshots, and a model with weak visual
understanding usually loses to a smaller one that can actually see. Pick a vision-capable
model, or keep a text-only analysis model and point a dedicated
[vision model](./LLM-Analysis#screenshots--vision-input-test-analysis) at transcription.

Format. The prompts ask for structured markdown. Models that wander off-format produce
output that's hard to read and hard to reuse.

Reasoning that stops. More reasoning helps up to a point; models that overthink burn tokens
and wall-clock without a better answer. Watch out for tokens-per-second here - a tiny model
stuck in long reasoning loops is often slower end to end than a bigger model that thinks
quickly and answers short. Judge by round-trip on a real failure, not the tps number.

## Sampling settings

These carry across models and usually matter more than the model itself.

- **Temperature** - trade determinism for enough variety to explain. Below ~0.2-0.3
  reasoning models can collapse into repetitive chain-of-thought, so keep 0.2-0.3 for
  frontier models and 0.6-0.7 for reasoning ones (they calibrate inside the think block).
- **Top K** - cap the candidate pool (`~40-64`) to cut off hallucinated identifiers.
- **Top P** - dynamic pool by cumulative probability; `0.95` is conventional.
- **Min P** - a relative floor instead of top_p/top_k; fine left off when the other two are set.
- **Repeat penalty** - leave at `1.0`. It's semantics-blind, and analysis reasons about the
  same failure and code blocks on purpose.
- **Max tokens** - a hard generation cap; leave headroom, reasoning runs long.

## Local

Run local models through LM Studio, oMLX, or Ollama (any OpenAI-compatible endpoint). Pick
by the unified memory or VRAM you can spare. Quality drops first on the hardest task,
project summaries.

| Hardware | Reach for | Expect |
|----------|-----------|--------|
| Small (≈8 GB) | a small instruct model | fast test analysis, weak on report/project summaries |
| Mid (≈12-16 GB) | a small-to-mid instruct or vision model | solid across all three tasks |
| Large (24 GB+) | a mid-size MoE or light-reasoning model | best local quality, slower round-trip |

Prefer instruct or lightly-reasoning models over heavy reasoners for this work, lean toward
vision-capable ones for test analysis, and remember a fast small model you keep enabled
beats a big one that keeps timing out.

## Remote

Any OpenAI-compatible or Anthropic-format provider works; OpenRouter reaches many at once.
Pick by what you're optimising for.

| Optimising for | Reach for |
|------|-----------|
| Quality | a current frontier flagship |
| Cost and latency | a small "mini" model - good enough for most failures |
| The middle | a fast-tier model (the fast/haiku/flash class) |
| Zero budget | a free-tier model on OpenRouter |

## Combining models

You don't have to settle on one. Pair a cheap tier-1 with a strong top tier so only the
hard cases escalate (cascade), or ensemble peer-quality models (fusion, council). See
[LLM routing](./LLM-Routing).

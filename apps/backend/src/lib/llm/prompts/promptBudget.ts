import type { SegmentedPrompt } from '../types/index.js';
import { truncateMiddle } from './textTransforms.js';

export interface PromptFitResult {
  prompt: SegmentedPrompt;
  changes: string[];
}

const segmentChars = (p: SegmentedPrompt): number =>
  p.segments.reduce((sum, s) => sum + s.content.length, 0);

const dropSegment = (p: SegmentedPrompt, id: string): SegmentedPrompt | null => {
  const idx = p.segments.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  return { segments: p.segments.filter((_, i) => i !== idx) };
};

const transformSegment = (
  p: SegmentedPrompt,
  id: string,
  fn: (content: string) => string
): SegmentedPrompt | null => {
  const idx = p.segments.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  const next = [...p.segments];
  const newContent = fn(next[idx].content);
  if (newContent === next[idx].content) return null;
  next[idx] = { ...next[idx], content: newContent };
  return { segments: next };
};

/** Replace each fenced block with a middle-truncated copy at the given size. */
function shrinkFencedBlocks(content: string, blockMax: number): string {
  return content.replace(/```([\s\S]*?)```/g, (_full, body: string) => {
    if (body.length <= blockMax) return `\`\`\`${body}\`\`\``;
    return `\`\`\`${truncateMiddle(body, blockMax)}\`\`\``;
  });
}

/** Drop the recent-categories line — least informative when budget tight.
 *  Must match the line emitted by buildHistoricalContextBlock:
 *  `- recent_categories (newest first): …`. */
function shrinkHistoricalContext(content: string): string {
  return content.replace(/- recent_categories\b.*\n/, '');
}

/** Cap a block to a max char count by truncating from the tail (keeps the
 *  header + first entries, drops the older ones). Used for evidence segments
 *  whose entries are ordered "most informative first." */
function truncateTail(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return `${content.substring(0, maxChars)}\n[… truncated to fit budget …]`;
}

/**
 * Fit a SegmentedPrompt to `charsBudget` by applying shrink steps in priority
 * order until size <= budget or all steps are exhausted. Stable segments
 * (system_prompt, task_contract) are never touched — they're the cacheable
 * prefix and dropping them would defeat caching for marginal char savings.
 */
export function fitPromptToBudget(prompt: SegmentedPrompt, charsBudget: number): PromptFitResult {
  if (segmentChars(prompt) <= charsBudget) {
    return { prompt, changes: [] };
  }

  const changes: string[] = [];
  let p = prompt;

  const tryStep = (
    label: string,
    apply: (current: SegmentedPrompt) => SegmentedPrompt | null
  ): boolean => {
    if (segmentChars(p) <= charsBudget) return true;
    const next = apply(p);
    if (next && segmentChars(next) < segmentChars(p)) {
      p = next;
      changes.push(label);
    }
    return segmentChars(p) <= charsBudget;
  };

  // Evidence segments — tail-truncate before dropping anything. Each block's
  // most-informative entries are at the top (failed network requests first,
  // error console messages first, errored action last) so head-preserving
  // truncation keeps the highest-signal content.
  for (const { id, cap } of [
    { id: 'page_snapshot', cap: 1500 },
    { id: 'network_activity', cap: 2000 },
    { id: 'console_log', cap: 1200 },
    { id: 'recent_actions', cap: 1000 },
  ]) {
    if (
      tryStep(`tail-truncated ${id} to ${cap} chars`, (cur) =>
        transformSegment(cur, id, (c) => truncateTail(c, cap))
      )
    ) {
      return { prompt: p, changes };
    }
  }

  if (
    tryStep('shrunk historical context', (cur) =>
      transformSegment(cur, 'historical_context', shrinkHistoricalContext)
    )
  ) {
    return { prompt: p, changes };
  }

  // Middle-truncate fenced blocks in current_failure (error message + stack trace).
  // Iteratively shrink with progressively tighter limits until we fit.
  for (const blockMax of [8000, 4000, 2000, 1000]) {
    if (
      tryStep(`truncated error/stack to ${blockMax} chars`, (cur) =>
        transformSegment(cur, 'current_failure', (c) => shrinkFencedBlocks(c, blockMax))
      )
    ) {
      return { prompt: p, changes };
    }
  }

  if (tryStep('dropped user feedback', (cur) => dropSegment(cur, 'user_feedback'))) {
    return { prompt: p, changes };
  }

  // Cross-project context drops only after every other shrink option is
  // exhausted — a validated prior analysis on the same signature is the
  // single strongest predictor of the right diagnosis.
  if (
    tryStep('dropped cross-project context', (cur) => dropSegment(cur, 'cross_project_context'))
  ) {
    return { prompt: p, changes };
  }

  // Last resort: middle-truncate every non-stable segment to its share of the budget.
  const stableChars = p.segments
    .filter((s) => s.stable)
    .reduce((sum, s) => sum + s.content.length, 0);
  const varyingBudget = Math.max(1000, charsBudget - stableChars);
  const varyingCount = p.segments.filter((s) => !s.stable).length;
  if (varyingCount > 0) {
    const perSegment = Math.floor(varyingBudget / varyingCount);
    p = {
      segments: p.segments.map((s) =>
        s.stable ? s : { ...s, content: truncateMiddle(s.content, perSegment) }
      ),
    };
    changes.push(`hard-truncated varying segments to ${perSegment} chars each`);
  }

  return { prompt: p, changes };
}

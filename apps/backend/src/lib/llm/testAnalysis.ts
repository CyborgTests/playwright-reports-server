import { unescapeLiteralNewlines } from './prompts/index.js';

/**
 * Parse the markdown response for a per-test failure analysis. The model is
 * asked to reply as plain markdown ending with an optional footer line:
 *
 *   Category: <enum value>
 *
 * Strip the footer (and any preceding `---` rule) so it doesn't appear in the
 * displayed analysis, and return the category for the consensus rule in the
 * queue. `category` is `null` when the model omitted the footer (the heuristic
 * baseline wins by default).
 */
export interface ParsedTestAnalysis {
  analysis: string;
  category: string | null;
}

// Last `Category: xyz` line at the very end of the text, optionally preceded by
// a horizontal rule. Tolerates underscores, hyphens, and spaces between the
// label and the value.
const CATEGORY_FOOTER_RE =
  /(?:^|\n)\s*(?:---+\s*\n+)?\s*Category\s*:\s*`?([a-zA-Z][a-zA-Z0-9_-]*)`?\s*$/;

export function extractTestAnalysisFromMarkdown(rawContent: string): ParsedTestAnalysis {
  // Models that emit literal `\n` instead of actual newlines (some local
  // models still do, even without a JSON envelope around the response) need
  // unescaping before any regex parsing. Idempotent when no escapes present.
  const text = unescapeLiteralNewlines(rawContent).trim();

  const match = text.match(CATEGORY_FOOTER_RE);
  if (!match) {
    return { analysis: text, category: null };
  }

  const category = match[1].trim().toLowerCase();
  const analysis = text.slice(0, match.index ?? 0).trimEnd();
  return { analysis, category };
}

import { unescapeLiteralNewlines } from './prompts/index.js';

/**
 * The model ends its analysis with two footer lines we strip before display:
 *
 *   Decision: D1=<yes|no> D2=<yes|no> D3=<yes|no> D4=<yes|no>
 *   Category: <enum value>
 *
 * `category` is the parsed value, or `null` when the footer is missing (the
 * heuristic baseline wins by default).
 */
export interface ParsedTestAnalysis {
  analysis: string;
  category: string | null;
}

// Optional Decision line + Category line at the end, optionally after a `---`.
const CATEGORY_FOOTER_RE =
  /(?:^|\n)\s*(?:---+\s*\n+)?\s*(?:Decision\s*:[^\n]*\n+)?\s*Category\s*:\s*`?([a-zA-Z][a-zA-Z0-9_-]*)`?\s*$/;

// Fallback: a stray Decision line when the Category line is absent.
const DECISION_FOOTER_RE = /(?:^|\n)\s*(?:---+\s*\n+)?\s*Decision\s*:[^\n]*\s*$/;

export function extractTestAnalysisFromMarkdown(rawContent: string): ParsedTestAnalysis {
  // Some local models emit literal `\n` instead of newlines; unescape first.
  const text = unescapeLiteralNewlines(rawContent).trim();

  const match = text.match(CATEGORY_FOOTER_RE);
  if (!match) {
    return { analysis: text.replace(DECISION_FOOTER_RE, '').trimEnd(), category: null };
  }

  const category = match[1].trim().toLowerCase();
  const analysis = text.slice(0, match.index ?? 0).trimEnd();
  return { analysis, category };
}

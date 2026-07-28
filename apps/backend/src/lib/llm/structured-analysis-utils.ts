/**
 * Markdown-handling helpers shared by the analysis parsers
 * (reportAnalysis.ts, projectAnalysis.ts, testAnalysis.ts). The per-domain
 * parsers own the coercion to their own typed shapes; this module owns the
 * string-handling skeletons that don't depend on which verdict enum is in
 * play.
 */

/** LLMs occasionally wrap a `[label](pwrs:test/…)` link in backticks even
 *  though the prompt forbids it. Backticks turn the link into an inline
 *  `<code>` element, so the user sees the raw markdown source instead of a
 *  clickable link. Unwrap any run of matched backticks that surround a
 *  complete pwrs link so the body renders correctly downstream. */
const BACKTICK_WRAPPED_PWRS_LINK_RE = /(`+)(\[[^\]\n]+\]\(pwrs:(?:test|report)\/[^)\n]+\))\1/g;

export function unwrapBacktickedPwrsLinks(text: string): string {
  return text.replace(BACKTICK_WRAPPED_PWRS_LINK_RE, '$2');
}

/** First sentence of `text`, or first 280 chars truncated with an ellipsis
 *  when no sentence terminator is found. Used as a synthetic summary fallback
 *  when the LLM didn't emit one. */
export function firstSentence(text: string): string {
  const stripped = text.replace(/\s+/g, ' ').trim();
  const match = stripped.match(/^(.+?[.!?])(\s|$)/);
  if (match) return match[1];
  return stripped.length > 280 ? `${stripped.slice(0, 277)}…` : stripped;
}

/** Strip leading emoji / numbering / whitespace from a markdown heading
 *  text. Keeps the substantive heading word(s). */
export function cleanMarkdownHeading(raw: string): string {
  return raw.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s\d.)]+/u, '').trim();
}

/** Parsed shape of a markdown blob: any text before the first heading goes
 *  into `preamble`; each `## Heading` (1-3 hashes) starts a new section. */
export interface MarkdownSections {
  preamble: string;
  sections: Array<{ heading: string; body: string }>;
}

const HEADING_RE = /^#{1,3}\s+(.+?)\s*$/;

/** Walk `text` line by line, collecting headings into sections. Each
 *  section heading is run through `cleanMarkdownHeading` so a `## 🔍 Title`
 *  heading and a plain `## Title` heading produce the same `heading` field.
 *  Sections with empty bodies are filtered out. */
export function parseMarkdownSections(text: string): MarkdownSections {
  const lines = text.split('\n');
  type Buf = { heading: string; bodyLines: string[] };
  const sections: Buf[] = [];
  let current: Buf | null = null;
  let preamble = '';
  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) {
      if (current) sections.push(current);
      const heading = cleanMarkdownHeading(m[1]);
      current = { heading: heading || m[1].trim(), bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    } else {
      preamble += `${line}\n`;
    }
  }
  if (current) sections.push(current);

  const cleaned = sections
    .map((s) => ({ heading: s.heading, body: s.bodyLines.join('\n').trim() }))
    .filter((s) => s.body.length > 0);

  return { preamble: preamble.trim(), sections: cleaned };
}

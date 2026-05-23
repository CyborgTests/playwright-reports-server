/**
 * Type-agnostic helpers shared by the structured-analysis parsers
 * (reportAnalysis.ts, projectAnalysis.ts). The per-domain parsers own the
 * coercion to their own typed shapes; this module owns the string-handling
 * skeletons that don't depend on which verdict enum or codeRef shape is in
 * play.
 */

/** First sentence of `text`, or first 280 chars truncated with an ellipsis
 *  when no sentence terminator is found. Used as a synthetic summary fallback
 *  when the LLM didn't emit one. */
export function firstSentence(text: string): string {
  const stripped = text.replace(/\s+/g, ' ').trim();
  const match = stripped.match(/^(.+?[.!?])(\s|$)/);
  if (match) return match[1];
  return stripped.length > 280 ? `${stripped.slice(0, 277)}…` : stripped;
}

/**
 * Halve every run of 2+ consecutive backslashes — undoes one layer of
 * over-escaping from local models that emit multi-level JSON (e.g.
 * `\\\\\\\\n` where standard JSON would use `\\n` for an escaped newline).
 * Returns the input unchanged when no such runs are present, which callers
 * use as an idempotence signal to stop iterating.
 */
export function halveEscapedBackslashes(text: string): string {
  return text.replace(/\\{2,}/g, (m) => '\\'.repeat(Math.ceil(m.length / 2)));
}

/**
 * Try to recover a structured payload from `text` by parsing it as JSON.
 * Tries fenced JSON (```json … ```) first, then the raw text. Each candidate
 * is handed to `parseStructured`; the first successful coercion wins.
 *
 * Some local models emit multi-level-escaped JSON — e.g. `\\\\\\\\` 
 * where standard JSON would use `\\` for a single backslash. We iteratively 
 * halve runs of 2+ consecutive backslashes and retry `JSON.parse` 
 * so those payloads recover instead of landing in the markdown-fallback path
 * with backslashes still visible.
 *
 * Returns null when neither candidate yields a structured payload.
 */
export function tryParseJsonAsStructured<T>(
  text: string,
  parseStructured: (raw: unknown) => T | null
): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text].filter((c): c is string => typeof c === 'string');
  for (const candidate of candidates) {
    let cur = candidate;
    for (let i = 0; i < 8; i++) {
      try {
        const parsed = JSON.parse(cur);
        const structured = parseStructured(parsed);
        if (structured) return structured;
        break;
      } catch {
        // halve and retry
      }
      const halved = halveEscapedBackslashes(cur);
      if (halved === cur) break;
      cur = halved;
    }
  }
  return null;
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

import type {
  ProjectAnalysisCodeRef,
  ProjectAnalysisSection,
  ProjectAnalysisStructured,
  ProjectAnalysisVerdict,
} from '@playwright-reports/shared';

const VERDICTS: readonly ProjectAnalysisVerdict[] = [
  'healthy',
  'stabilizing',
  'degrading',
  'failing',
];

function isVerdict(value: unknown): value is ProjectAnalysisVerdict {
  return typeof value === 'string' && (VERDICTS as readonly string[]).includes(value);
}

function coerceCodeRef(raw: unknown): ProjectAnalysisCodeRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const file = typeof r.file === 'string' ? r.file.trim() : '';
  if (!file) return null;
  const line =
    typeof r.line === 'number' && Number.isFinite(r.line) && r.line > 0
      ? Math.floor(r.line)
      : undefined;
  const reportId =
    typeof r.reportId === 'string' && r.reportId.trim().length > 0 ? r.reportId.trim() : undefined;
  return { file, line, reportId };
}

function coerceSection(raw: unknown): ProjectAnalysisSection | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const heading = typeof r.heading === 'string' ? r.heading.trim() : '';
  const body = typeof r.body === 'string' ? r.body.trim() : '';
  if (!heading || !body) return null;
  const codeRefs = Array.isArray(r.codeRefs)
    ? r.codeRefs.map(coerceCodeRef).filter((x): x is ProjectAnalysisCodeRef => x !== null)
    : undefined;
  return { heading, body, codeRefs: codeRefs && codeRefs.length > 0 ? codeRefs : undefined };
}

/**
 * Coerce arbitrary LLM-emitted JSON into the strict ProjectAnalysisStructured
 * shape. Returns null when the payload is missing the required fields after
 * normalization — callers should fall back to plain-text rendering.
 */
export function parseProjectAnalysisStructured(raw: unknown): ProjectAnalysisStructured | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const verdict = isVerdict(r.verdict) ? r.verdict : null;
  const summary = typeof r.summary === 'string' ? r.summary.trim() : '';
  if (!verdict || !summary) return null;
  const sections = Array.isArray(r.sections)
    ? r.sections.map(coerceSection).filter((s): s is ProjectAnalysisSection => s !== null)
    : [];
  if (sections.length === 0) return null;
  return { verdict, summary, sections };
}

/**
 * Last-resort fallback when the provider returns plain text instead of
 * structured JSON. Strategies, in order:
 *
 *   1. Parse fenced JSON blocks or raw JSON.
 *   2. Parse a markdown document with `## Heading` sections — produces a
 *      structured payload by inferring verdict from keywords and treating
 *      each top-level heading as a section.
 *
 * Returns null only when none of these strategies recover usable content;
 * callers then surface the raw markdown via the legacy `summary` field.
 */
export function parseProjectAnalysisFromText(text: string): ProjectAnalysisStructured | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 1. JSON: fenced or raw.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], trimmed].filter((c): c is string => typeof c === 'string');
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const structured = parseProjectAnalysisStructured(parsed);
      if (structured) return structured;
    } catch {
      // ignore — try next
    }
  }

  // 2. Markdown headings.
  return parseProjectAnalysisFromMarkdown(trimmed);
}

const VERDICT_HEURISTICS: Array<{ verdict: ProjectAnalysisVerdict; patterns: RegExp[] }> = [
  {
    verdict: 'failing',
    patterns: [/\bfailing\b/i, /\bcritical\b/i, /widespread failures/i, /many runs are red/i],
  },
  {
    verdict: 'degrading',
    patterns: [/\bdegrading\b/i, /getting worse/i, /\bregress(ing|ion)\b/i],
  },
  {
    verdict: 'stabilizing',
    patterns: [/\bstabili(s|z)ing\b/i, /improving/i, /recovering/i],
  },
  {
    verdict: 'healthy',
    patterns: [/\bhealthy\b/i, /all (green|passing)/i, /no failures/i],
  },
];

function inferVerdictFromText(text: string): ProjectAnalysisVerdict {
  // First match wins; ordering puts the most-severe verdicts first so an
  // analysis that says "improving from failing" lands on 'failing' rather
  // than 'stabilizing'.
  for (const { verdict, patterns } of VERDICT_HEURISTICS) {
    if (patterns.some((p) => p.test(text))) return verdict;
  }
  return 'degrading';
}

const HEADING_RE = /^#{1,3}\s+(.+?)\s*$/;

/**
 * Parse a markdown blob into a structured analysis by treating each top-level
 * heading as a section. Heading text is stripped of leading emoji/numbering
 * so `## 🔍 Health Assessment` and `## Health Assessment` produce the same
 * `heading` field — matches what the new prompt asks for and keeps legacy
 * outputs renderable.
 */
function parseProjectAnalysisFromMarkdown(text: string): ProjectAnalysisStructured | null {
  const lines = text.split('\n');
  type Buf = { heading: string; bodyLines: string[] };
  const sections: Buf[] = [];
  let current: Buf | null = null;
  let preamble = '';
  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) {
      if (current) sections.push(current);
      const heading = m[1]
        .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s\d.)]+/u, '')
        .trim();
      current = { heading: heading || m[1].trim(), bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    } else {
      preamble += `${line}\n`;
    }
  }
  if (current) sections.push(current);

  const cleaned = sections
    .map((s): ProjectAnalysisSection | null => {
      const body = s.bodyLines.join('\n').trim();
      if (!body) return null;
      return { heading: s.heading, body };
    })
    .filter((s): s is ProjectAnalysisSection => s !== null);

  // If no headings at all, treat the whole blob as a single section.
  if (cleaned.length === 0) {
    const body = preamble.trim();
    if (!body) return null;
    return {
      verdict: inferVerdictFromText(body),
      summary: firstSentence(body),
      sections: [{ heading: 'Analysis', body }],
    };
  }

  const summary = preamble.trim() || firstSentence(cleaned[0].body);
  return {
    verdict: inferVerdictFromText(text),
    summary: summary || cleaned[0].heading,
    sections: cleaned,
  };
}

function firstSentence(text: string): string {
  const stripped = text.replace(/\s+/g, ' ').trim();
  const match = stripped.match(/^(.+?[.!?])(\s|$)/);
  if (match) return match[1];
  return stripped.length > 280 ? `${stripped.slice(0, 277)}…` : stripped;
}

/**
 * Render a structured analysis back to markdown for the legacy `summary`
 * column (still consumed by the report-viewer LLM-injection feature and any
 * older clients that haven't been updated yet).
 */
export function renderProjectAnalysisAsMarkdown(s: ProjectAnalysisStructured): string {
  let out = '';
  out += `**Verdict:** ${s.verdict[0].toUpperCase()}${s.verdict.slice(1)}\n\n`;
  out += `${s.summary}\n`;
  for (const section of s.sections) {
    out += `\n## ${section.heading}\n${section.body.trim()}\n`;
  }
  return out.trim();
}

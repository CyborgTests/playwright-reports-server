import type {
  ProjectAnalysisCodeRef,
  ProjectAnalysisSection,
  ProjectAnalysisStructured,
  ProjectAnalysisVerdict,
} from '@playwright-reports/shared';
import {
  firstSentence,
  parseMarkdownSections,
  tryParseJsonAsStructured,
} from './structured-analysis-utils.js';

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
 * structured JSON. Tries fenced/raw JSON first, then falls back to parsing
 * markdown `## Heading` sections with a heuristic verdict inferred from
 * keywords. Returns null only when nothing usable could be recovered.
 */
export function parseProjectAnalysisFromText(text: string): ProjectAnalysisStructured | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fromJson = tryParseJsonAsStructured(trimmed, parseProjectAnalysisStructured);
  if (fromJson) return fromJson;

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

function parseProjectAnalysisFromMarkdown(text: string): ProjectAnalysisStructured | null {
  const { preamble, sections } = parseMarkdownSections(text);

  if (sections.length === 0) {
    if (!preamble) return null;
    return {
      verdict: inferVerdictFromText(preamble),
      summary: firstSentence(preamble),
      sections: [{ heading: 'Analysis', body: preamble }],
    };
  }

  const summary = preamble || firstSentence(sections[0].body);
  return {
    verdict: inferVerdictFromText(text),
    summary: summary || sections[0].heading,
    sections,
  };
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

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

const CODE_REF_KINDS = ['test', 'file'] as const;

function isVerdict(value: unknown): value is ProjectAnalysisVerdict {
  return typeof value === 'string' && (VERDICTS as readonly string[]).includes(value);
}

function isKind(value: unknown): value is ProjectAnalysisCodeRef['kind'] {
  return typeof value === 'string' && (CODE_REF_KINDS as readonly string[]).includes(value);
}

/**
 * Coerce one model-emitted code ref into the strict shape. Accepts both:
 *  - new shape: `{kind, label, testId?, fileId?, filePath?, line?, reportId?}`
 *  - legacy shape: `{file, line?, reportId?}` — pre-R3 rows still in
 *    `project_llm_summaries.structured`. Treated as `kind: 'file'`.
 * Drops refs that lack the fields required to render a navigable link.
 */
function coerceCodeRef(raw: unknown): ProjectAnalysisCodeRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const line =
    typeof r.line === 'number' && Number.isFinite(r.line) && r.line > 0
      ? Math.floor(r.line)
      : undefined;
  const reportId =
    typeof r.reportId === 'string' && r.reportId.trim().length > 0 ? r.reportId.trim() : undefined;

  if (isKind(r.kind)) {
    // New shape.
    const kind = r.kind;
    const label = typeof r.label === 'string' ? r.label.trim() : '';
    if (!label) return null;
    const testId = typeof r.testId === 'string' && r.testId.trim() ? r.testId.trim() : undefined;
    const fileId = typeof r.fileId === 'string' && r.fileId.trim() ? r.fileId.trim() : undefined;
    const filePath =
      typeof r.filePath === 'string' && r.filePath.trim() ? r.filePath.trim() : undefined;
    // A test ref needs at least a testId to be navigable. A file ref needs at
    // least a filePath. Drop refs that can't render as a link.
    if (kind === 'test' && !testId) return null;
    if (kind === 'file' && !filePath) return null;
    return { kind, label, testId, fileId, filePath, reportId, line };
  }

  // Legacy fallback: pre-R3 `{file, line?, reportId?}` shape still in cached
  // structured payloads. Coerce to `kind: 'file'` so the renderer treats them
  // uniformly with new entries.
  const file = typeof r.file === 'string' ? r.file.trim() : '';
  if (!file) return null;
  return { kind: 'file', label: file, filePath: file, reportId, line };
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
 * Strip code refs that point to data the UI can't resolve into a link:
 *  - `kind: 'test'` refs whose testId isn't in `validTestIds`.
 *  - any ref whose `reportId` is set but isn't in `validReportIds`.
 *
 * Models occasionally fabricate testIds/reportIds when they pattern-match the
 * shape; without validation those render as 404 links. Returns a new
 * structured payload — the input is left untouched.
 */
export function pruneInvalidCodeRefs(
  s: ProjectAnalysisStructured,
  validTestIds: ReadonlySet<string>,
  validReportIds: ReadonlySet<string>
): ProjectAnalysisStructured {
  const cleanSections = s.sections.map((section): ProjectAnalysisSection => {
    if (!section.codeRefs || section.codeRefs.length === 0) return section;
    const kept = section.codeRefs.filter((ref) => {
      if (ref.kind === 'test' && ref.testId && !validTestIds.has(ref.testId)) return false;
      if (ref.reportId && !validReportIds.has(ref.reportId)) return false;
      return true;
    });
    return { ...section, codeRefs: kept.length > 0 ? kept : undefined };
  });
  return { ...s, sections: cleanSections };
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

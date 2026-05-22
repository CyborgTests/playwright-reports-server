import type {
  ReportAnalysisCodeRef,
  ReportAnalysisImpact,
  ReportAnalysisSection,
  ReportAnalysisStructured,
  ReportAnalysisVerdict,
} from '@playwright-reports/shared';
import {
  firstSentence,
  parseMarkdownSections,
  tryParseJsonAsStructured,
} from './structured-analysis-utils.js';

const VERDICTS: readonly ReportAnalysisVerdict[] = [
  'isolated',
  'clustered',
  'widespread',
  'systemic',
];

const IMPACTS: readonly ReportAnalysisImpact[] = ['high', 'medium', 'low'];

const CODE_REF_KINDS = ['test', 'file'] as const;

function isVerdict(value: unknown): value is ReportAnalysisVerdict {
  return typeof value === 'string' && (VERDICTS as readonly string[]).includes(value);
}

function isImpact(value: unknown): value is ReportAnalysisImpact {
  return typeof value === 'string' && (IMPACTS as readonly string[]).includes(value);
}

function isKind(value: unknown): value is ReportAnalysisCodeRef['kind'] {
  return typeof value === 'string' && (CODE_REF_KINDS as readonly string[]).includes(value);
}

function coerceCodeRef(raw: unknown): ReportAnalysisCodeRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = isKind(r.kind) ? r.kind : null;
  if (!kind) return null;
  const label = typeof r.label === 'string' ? r.label.trim() : '';
  if (!label) return null;
  const testId = typeof r.testId === 'string' && r.testId.trim() ? r.testId.trim() : undefined;
  const fileId = typeof r.fileId === 'string' && r.fileId.trim() ? r.fileId.trim() : undefined;
  const filePath =
    typeof r.filePath === 'string' && r.filePath.trim() ? r.filePath.trim() : undefined;
  const line =
    typeof r.line === 'number' && Number.isFinite(r.line) && r.line > 0
      ? Math.floor(r.line)
      : undefined;
  // A test ref needs at least a testId to be navigable. A file ref needs at
  // least a filePath. Drop refs that can't be rendered as a link.
  if (kind === 'test' && !testId) return null;
  if (kind === 'file' && !filePath) return null;
  return { kind, label, testId, fileId, filePath, line };
}

function coerceSection(raw: unknown): ReportAnalysisSection | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const heading = typeof r.heading === 'string' ? r.heading.trim() : '';
  const body = typeof r.body === 'string' ? r.body.trim() : '';
  if (!heading || !body) return null;
  const impact = isImpact(r.impact) ? r.impact : undefined;
  const codeRefs = Array.isArray(r.codeRefs)
    ? r.codeRefs.map(coerceCodeRef).filter((x): x is ReportAnalysisCodeRef => x !== null)
    : undefined;
  return {
    heading,
    body,
    impact,
    codeRefs: codeRefs && codeRefs.length > 0 ? codeRefs : undefined,
  };
}

export function parseReportAnalysisStructured(raw: unknown): ReportAnalysisStructured | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const verdict = isVerdict(r.verdict) ? r.verdict : null;
  const summary = typeof r.summary === 'string' ? r.summary.trim() : '';
  if (!verdict || !summary) return null;
  const sections = Array.isArray(r.sections)
    ? r.sections.map(coerceSection).filter((s): s is ReportAnalysisSection => s !== null)
    : [];
  if (sections.length === 0) return null;
  return { verdict, summary, sections };
}

export function parseReportAnalysisFromText(text: string): ReportAnalysisStructured | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fromJson = tryParseJsonAsStructured(trimmed, parseReportAnalysisStructured);
  if (fromJson) return fromJson;

  return parseReportAnalysisFromMarkdown(trimmed);
}

// Order matters: most-severe first so phrases like "fixing the systemic issue"
// land on `systemic` rather than `isolated`.
const VERDICT_HEURISTICS: Array<{ verdict: ReportAnalysisVerdict; patterns: RegExp[] }> = [
  {
    verdict: 'systemic',
    patterns: [/\bsystemic\b/i, /shared fixture/i, /infra(structure)?\b/i, /setup\/teardown/i],
  },
  {
    verdict: 'widespread',
    patterns: [/\bwidespread\b/i, /multiple categories/i, /across the board/i],
  },
  {
    verdict: 'clustered',
    patterns: [/\bcluster(ed|ing)?\b/i, /\bdominant\b/i, /same (root cause|signature)/i],
  },
  {
    verdict: 'isolated',
    patterns: [/\bisolated\b/i, /\bone-off\b/i, /single failure/i],
  },
];

function inferVerdictFromText(text: string): ReportAnalysisVerdict {
  for (const { verdict, patterns } of VERDICT_HEURISTICS) {
    if (patterns.some((p) => p.test(text))) return verdict;
  }
  return 'clustered';
}

function parseReportAnalysisFromMarkdown(text: string): ReportAnalysisStructured | null {
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

export function renderReportAnalysisAsMarkdown(s: ReportAnalysisStructured): string {
  let out = '';
  out += `**Verdict:** ${s.verdict[0].toUpperCase()}${s.verdict.slice(1)}\n\n`;
  out += `${s.summary}\n`;
  for (const section of s.sections) {
    const impactTag = section.impact ? ` _(${section.impact} impact)_` : '';
    out += `\n## ${section.heading}${impactTag}\n${section.body.trim()}\n`;
  }
  return out.trim();
}

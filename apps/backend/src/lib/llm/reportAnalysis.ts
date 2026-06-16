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
  unwrapBacktickedPwrsLinks,
} from './structured-analysis-utils.js';

const VERDICTS: readonly ReportAnalysisVerdict[] = [
  'isolated',
  'clustered',
  'widespread',
  'systemic',
];

const IMPACTS: readonly ReportAnalysisImpact[] = ['high', 'medium', 'low'];

function isVerdict(value: string): value is ReportAnalysisVerdict {
  return (VERDICTS as readonly string[]).includes(value);
}

function isImpact(value: string): value is ReportAnalysisImpact {
  return (IMPACTS as readonly string[]).includes(value);
}

/**
 * Parse the model's report analysis: a `**Verdict:** clustered` line, an
 * executive-summary paragraph, then `## Section _(impact tag)_` blocks carrying
 * `[label](pwrs:test/TID)` / `[label](pwrs:file/PATH:42)` refs. Recovers the
 * verdict, summary, sections, per-section impact tag, and code refs; returns
 * null only when the response is empty.
 */
export function parseReportAnalysisFromText(text: string): ReportAnalysisStructured | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
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

// `**Verdict:** clustered` — anywhere from the first 5 non-empty lines.
// Tolerates `Verdict: clustered`, `**Verdict:** "clustered"`, surrounding
// backticks, and a leading blank/whitespace.
const VERDICT_LINE_RE =
  /(?:^|\n)\s*(?:\*\*)?Verdict(?:\*\*)?\s*:?\s*\*?\*?\s*["`]?([a-zA-Z]+)["`]?\s*\*?\*?\s*(?=\n|$)/;

function extractVerdict(text: string): {
  verdict: ReportAnalysisVerdict;
  remaining: string;
} {
  const match = text.match(VERDICT_LINE_RE);
  if (match) {
    const candidate = match[1].toLowerCase();
    if (isVerdict(candidate)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const remaining = (text.slice(0, start) + text.slice(end)).trim();
      return { verdict: candidate, remaining };
    }
  }
  return { verdict: inferVerdictFromText(text), remaining: text };
}

const IMPACT_SUFFIX_RE = /\s*_\(\s*(high|medium|low)\s+impact\s*\)_\s*$/i;

function splitImpactFromHeading(rawHeading: string): {
  heading: string;
  impact?: ReportAnalysisImpact;
} {
  const m = rawHeading.match(IMPACT_SUFFIX_RE);
  if (!m) return { heading: rawHeading };
  const candidate = m[1].toLowerCase();
  if (!isImpact(candidate)) return { heading: rawHeading };
  return { heading: rawHeading.replace(IMPACT_SUFFIX_RE, '').trim(), impact: candidate };
}

/** `[label](pwrs:test/TEST_ID?project=PROJECT)` link matcher. Only test refs
 *  are navigable from a single-report analysis. The `?project=…` query is
 *  read here so the persisted codeRefs carry the project the model cited;
 *  the backend's report-project fallback fills it in if the model forgot. */
const PWRS_TEST_LINK_RE = /\[([^\]\n]+)\]\(pwrs:test\/([^)\n]+)\)/g;

function parseProjectFromQuery(queryStr: string | undefined): string | undefined {
  if (!queryStr) return undefined;
  for (const pair of queryStr.split('&')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    if (pair.slice(0, eq) !== 'project') continue;
    const raw = pair.slice(eq + 1);
    if (!raw) return undefined;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

function extractCodeRefsFromBody(body: string): ReportAnalysisCodeRef[] {
  const refs: ReportAnalysisCodeRef[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(PWRS_TEST_LINK_RE)) {
    const label = m[1].trim();
    const target = m[2].trim();
    const qIdx = target.indexOf('?');
    const pathPart = qIdx === -1 ? target : target.slice(0, qIdx);
    const queryStr = qIdx === -1 ? undefined : target.slice(qIdx + 1);
    if (!pathPart || pathPart.includes('/')) continue;
    const testId = pathPart;
    const project = parseProjectFromQuery(queryStr);
    const key = `${testId}:${project ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ kind: 'test', label, testId, project });
  }
  return refs;
}

function parseReportAnalysisFromMarkdown(text: string): ReportAnalysisStructured | null {
  const { verdict, remaining } = extractVerdict(unwrapBacktickedPwrsLinks(text));
  const { preamble, sections } = parseMarkdownSections(remaining);

  if (sections.length === 0) {
    if (!preamble) return null;
    return {
      verdict,
      summary: firstSentence(preamble),
      sections: [{ heading: 'Analysis', body: preamble }],
    };
  }

  const summary = preamble || firstSentence(sections[0].body) || sections[0].heading;
  const enriched: ReportAnalysisSection[] = sections.map((s) => {
    const { heading, impact } = splitImpactFromHeading(s.heading);
    const codeRefs = extractCodeRefsFromBody(s.body);
    return {
      heading,
      body: s.body,
      impact,
      codeRefs: codeRefs.length > 0 ? codeRefs : undefined,
    };
  });

  return { verdict, summary, sections: enriched };
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

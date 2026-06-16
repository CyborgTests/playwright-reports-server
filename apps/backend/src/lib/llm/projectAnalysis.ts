import type {
  ProjectAnalysisCodeRef,
  ProjectAnalysisSection,
  ProjectAnalysisStructured,
  ProjectAnalysisVerdict,
} from '@playwright-reports/shared';
import {
  firstSentence,
  parseMarkdownSections,
  unwrapBacktickedPwrsLinks,
} from './structured-analysis-utils.js';

const VERDICTS: readonly ProjectAnalysisVerdict[] = [
  'healthy',
  'stabilizing',
  'degrading',
  'failing',
];

function isVerdict(value: string): value is ProjectAnalysisVerdict {
  return (VERDICTS as readonly string[]).includes(value);
}

/**
 * Parse the model's project analysis: a `**Verdict:** stabilizing` line, a
 * one-line headline, then `## Section` blocks carrying `pwrs:test/`,
 * `pwrs:file/`, and `pwrs:report/` refs. Returns null only when empty.
 */
export function parseProjectAnalysisFromText(text: string): ProjectAnalysisStructured | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
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
  for (const { verdict, patterns } of VERDICT_HEURISTICS) {
    if (patterns.some((p) => p.test(text))) return verdict;
  }
  return 'degrading';
}

const VERDICT_LINE_RE =
  /(?:^|\n)\s*(?:\*\*)?Verdict(?:\*\*)?\s*:?\s*\*?\*?\s*["`]?([a-zA-Z]+)["`]?\s*\*?\*?\s*(?=\n|$)/;

function extractVerdict(text: string): {
  verdict: ProjectAnalysisVerdict;
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

/** `[label](pwrs:(test|report)/TARGET)` link matcher. File refs are not
 *  emitted by the prompts (no per-file SPA route); plain backticked file
 *  paths cover that case in prose. Test refs carry `?project=…` so the
 *  cross-project "all" aggregate can name each test's own project. */
const PWRS_LINK_RE = /\[([^\]\n]+)\]\(pwrs:(test|report)\/([^)\n]+)\)/g;

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

function extractCodeRefsFromBody(body: string): ProjectAnalysisCodeRef[] {
  const refs: ProjectAnalysisCodeRef[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(PWRS_LINK_RE)) {
    const label = m[1].trim();
    const kind = m[2] as 'test' | 'report';
    const target = m[3].trim();
    if (kind === 'test') {
      const qIdx = target.indexOf('?');
      const pathPart = qIdx === -1 ? target : target.slice(0, qIdx);
      const queryStr = qIdx === -1 ? undefined : target.slice(qIdx + 1);
      if (!pathPart || pathPart.includes('/')) continue;
      const testId = pathPart;
      const project = parseProjectFromQuery(queryStr);
      const key = `test:${testId}:${project ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ kind: 'test', label, testId, project });
      continue;
    }
    // report: encoded as { kind: 'file', label, reportId } because the
    // frontend renderer treats kind='file' + reportId as a /report/:id link
    // without requiring a filePath. Adding a new discriminator would break
    // backwards compatibility with cached structured payloads in the DB.
    const reportId = target;
    if (!reportId) continue;
    const key = `report:${reportId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ kind: 'file', label, reportId });
  }
  return refs;
}

function parseProjectAnalysisFromMarkdown(text: string): ProjectAnalysisStructured | null {
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
  const enriched: ProjectAnalysisSection[] = sections.map((s) => {
    const codeRefs = extractCodeRefsFromBody(s.body);
    return {
      heading: s.heading,
      body: s.body,
      codeRefs: codeRefs.length > 0 ? codeRefs : undefined,
    };
  });

  return { verdict, summary, sections: enriched };
}

const LABELED_TEST_TAG_RE =
  /(?:`([^`\n]+)`|\*\*([^*\n]+)\*\*)\s*\[testId:\s*([A-Za-z0-9_-]+)\s*\]/g;
const LABELED_REPORT_TAG_RE =
  /(?:`([^`\n]+)`|\*\*([^*\n]+)\*\*)\s*\[reportId:\s*([A-Za-z0-9_-]+)\s*\]/g;
const BARE_ID_TAG_RE = /\s*\[(?:test|report)Id:\s*[A-Za-z0-9_-]+\s*\]/g;

export function linkifyDataBlockTags(
  text: string,
  opts: {
    validTestIds: ReadonlySet<string>;
    validReportIds: ReadonlySet<string>;
    project?: string;
  }
): string {
  const projectSuffix = opts.project ? `?project=${encodeURIComponent(opts.project)}` : '';
  let out = text.replace(LABELED_TEST_TAG_RE, (_m, backtick, bold, tid) => {
    const label = String(backtick ?? bold).trim();
    if (!opts.validTestIds.has(tid)) return label;
    return `[${label}](pwrs:test/${tid}${projectSuffix})`;
  });
  out = out.replace(LABELED_REPORT_TAG_RE, (_m, backtick, bold, rid) => {
    const label = String(backtick ?? bold).trim();
    if (!opts.validReportIds.has(rid)) return label;
    return `[${label}](pwrs:report/${rid})`;
  });
  return out.replace(BARE_ID_TAG_RE, '');
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

export function renderProjectAnalysisAsMarkdown(s: ProjectAnalysisStructured): string {
  let out = '';
  out += `**Verdict:** ${s.verdict[0].toUpperCase()}${s.verdict.slice(1)}\n\n`;
  out += `${s.summary}\n`;
  for (const section of s.sections) {
    out += `\n## ${section.heading}\n${section.body.trim()}\n`;
  }
  return out.trim();
}

import type {
  ProjectAnalysisStructured,
  ReportAnalysisStructured,
} from '@playwright-reports/shared';
import { reportDb } from '../service/db/reports.sqlite.js';

/** markdown that must NOT be included: fenced code blocks,
 *  inline code spans, existing markdown links.
 */
const SKIP_TOKEN_RE =
  /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|!\[[^\]]*\]\([^)]*\)|\[[^\]]*\]\([^)]*\)|<https?:[^>\s]*>)/g;

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Match a `#NNN` report numeric reference*/
const DISPLAY_NUMBER_RE = /(^|[\s([{,;:.!?])#(\d+)\b/g;

export interface LinkifyContext {
  project?: string;
}

/**
 * Rewrite bare report references in an LLM-generated markdown document into
 * clickable `pwrs:` links.
 *  - UUIDs that look like a report ID -> `[uuid](pwrs:report/uuid)`
 *  - `#NNN` display numbers -> `[#NNN](pwrs:report/uuid)`
 */
export function linkifyReportRefs(markdown: string, ctx: LinkifyContext = {}): string {
  if (!markdown) return markdown;
  if (!UUID_RE.test(markdown) && !/#\d/.test(markdown)) {
    UUID_RE.lastIndex = 0;
    return markdown;
  }
  UUID_RE.lastIndex = 0;

  const parts = markdown.split(SKIP_TOKEN_RE);
  for (let i = 0; i < parts.length; i++) {
    const isSkipToken = i % 2 === 1;
    if (isSkipToken) continue;
    parts[i] = linkifySegment(parts[i], ctx);
  }
  return parts.join('');
}

function linkifySegment(text: string, ctx: LinkifyContext): string {
  let out = text;
  out = out.replace(UUID_RE, (uuid) => `[${uuid}](pwrs:report/${uuid})`);
  out = out.replace(DISPLAY_NUMBER_RE, (full, prefix: string, digits: string) => {
    const displayNumber = Number.parseInt(digits, 10);
    if (!Number.isFinite(displayNumber)) return full;
    const matches = reportDb.findByDisplayNumber(displayNumber, ctx.project);
    if (matches.length !== 1) return full;
    return `${prefix}[#${digits}](pwrs:report/${matches[0].reportID})`;
  });
  return out;
}

export function linkifyReportAnalysisStructured(
  structured: ReportAnalysisStructured,
  ctx: LinkifyContext = {}
): ReportAnalysisStructured {
  return {
    ...structured,
    summary: linkifyReportRefs(structured.summary, ctx),
    sections: structured.sections.map((s) => ({
      ...s,
      body: linkifyReportRefs(s.body, ctx),
    })),
  };
}

export function linkifyProjectAnalysisStructured(
  structured: ProjectAnalysisStructured,
  ctx: LinkifyContext = {}
): ProjectAnalysisStructured {
  return {
    ...structured,
    summary: linkifyReportRefs(structured.summary, ctx),
    sections: structured.sections.map((s) => ({
      ...s,
      body: linkifyReportRefs(s.body, ctx),
    })),
  };
}

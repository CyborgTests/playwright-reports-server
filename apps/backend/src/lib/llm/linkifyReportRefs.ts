import type {
  ProjectAnalysisStructured,
  ReportAnalysisStructured,
} from '@playwright-reports/shared';
import { reportDb } from '../service/db/index.js';

/** markdown that must NOT be included: fenced code blocks,
 *  inline code spans, existing markdown links.
 */
const SKIP_TOKEN_RE =
  /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|!\[[^\]]*\]\([^)]*\)|\[[^\]]*\]\([^)]*\)|<https?:[^>\s]*>)/g;

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Match a `#NNN` report numeric reference*/
const DISPLAY_NUMBER_RE = /(^|[\s([{,;:.!?])#(\d+)\b/g;

/** Marker syntax the prompts emit as DATA in the input. When the LLM ignores
 *  the instruction to wrap mentions as proper markdown links and instead
 *  echoes the marker token, this catches it as a fallback.
 */
const MARKER_RE = /\[(testId|reportId|clusterId):\s*([^\]\s]+)\s*\]/g;

const MARKER_KINDS: Record<string, 'test' | 'report' | 'cluster'> = {
  testId: 'test',
  reportId: 'report',
  clusterId: 'cluster',
};

const CODE_SPAN_MARKER_RE =
  /^`\s*(.*?)\s*\[(testId|reportId|clusterId):\s*([^\]\s]+)\s*\]\s*(.*?)\s*`$/;

/** Short label for the produced link. Long opaque IDs (40-char Playwright
 *  testIds, full UUIDs) read poorly inline; truncate to a recognizable
 *  prefix while preserving the full ID inside the link target. */
function shortLabel(kind: 'test' | 'report' | 'cluster', id: string): string {
  const trunc = id.length > 12 ? `${id.slice(0, 12)}…` : id;
  return `${kind} ${trunc}`;
}

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

  const afterMarkers = rewriteMarkers(markdown);

  if (!UUID_RE.test(afterMarkers) && !/#\d/.test(afterMarkers)) {
    UUID_RE.lastIndex = 0;
    return afterMarkers;
  }
  UUID_RE.lastIndex = 0;

  const parts = afterMarkers.split(SKIP_TOKEN_RE);
  for (let i = 0; i < parts.length; i++) {
    const isSkipToken = i % 2 === 1;
    if (isSkipToken) continue;
    parts[i] = linkifySegment(parts[i], ctx);
  }
  return parts.join('');
}

function rewriteMarkers(text: string): string {
  if (!text.includes('[')) return text; // micro-opt: no markers possible
  const parts = text.split(SKIP_TOKEN_RE);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      parts[i] = rewriteCodeSpanMarker(parts[i]);
      continue;
    }
    parts[i] = parts[i].replace(MARKER_RE, (full, kind: string, id: string) => {
      const cleanId = id.trim();
      const scheme = MARKER_KINDS[kind];
      if (!cleanId || !scheme) return full;
      return `[${shortLabel(scheme, cleanId)}](pwrs:${scheme}/${cleanId})`;
    });
  }
  return parts.join('');
}

function rewriteCodeSpanMarker(token: string): string {
  const match = token.match(CODE_SPAN_MARKER_RE);
  if (!match) return token;
  const [, before, kind, id, after] = match;
  const scheme = MARKER_KINDS[kind];
  if (!scheme) return token;
  const label = [before, after].filter(Boolean).join(' ').trim();
  return `[${label || shortLabel(scheme, id)}](pwrs:${scheme}/${id})`;
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

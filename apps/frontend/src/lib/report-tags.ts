import { RESERVED_REPORT_FIELDS, type ReportHistory } from '@playwright-reports/shared';

const isPrimitive = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

/**
 * The custom metadata of a report: every primitive field that isn't one of
 * Playwright's own report fields. Mirrors extractReportTags() on the backend,
 * which is what fills report_tags and therefore what `?tags=key:value` filters
 * on - keep the two in sync so the UI never shows a value that can't be
 * filtered by, or hides one that can.
 *
 * Nested objects (`metadata` with gitCommit/gitDiff, `stats`, `files`, ...) are
 * skipped, so a multi-megabyte git diff never reaches the markup.
 */
export function extractReportTags(report: ReportHistory): Record<string, string> {
  const tags: Record<string, string> = {};

  for (const [key, value] of Object.entries(report as ReportHistory & Record<string, unknown>)) {
    if (RESERVED_REPORT_FIELDS.has(key)) continue;
    if (!isPrimitive(value)) continue;
    tags[key] = String(value);
  }

  return tags;
}

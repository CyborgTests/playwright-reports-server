import type { ReportTest } from '@playwright-reports/shared';

/** Used for both `suitePath` and `tags`. */
export function normalizeStringArray(value: string[] | undefined): string | null {
  if (!Array.isArray(value)) return null;
  const entries = value.filter((entry) => typeof entry === 'string' && entry !== '');
  return entries.length > 0 ? JSON.stringify(entries) : null;
}

export function normalizeAnnotations(
  annotations: ReportTest['annotations'] | undefined
): string | null {
  if (!Array.isArray(annotations)) return null;
  const trimmed = annotations
    .filter((annotation) => typeof annotation?.type === 'string' && annotation.type !== '')
    .map((annotation) => {
      const description =
        typeof annotation.description === 'string' ? annotation.description : undefined;
      return description ? { type: annotation.type, description } : { type: annotation.type };
    });
  return trimmed.length > 0 ? JSON.stringify(trimmed) : null;
}

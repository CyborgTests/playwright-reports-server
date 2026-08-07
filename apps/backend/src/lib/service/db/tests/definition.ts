import type { ReportTest } from '@playwright-reports/shared';

/** Used for both `suitePath` and `tags`. */
export function normalizeStringArray(value: string[] | undefined): string | null {
  if (!Array.isArray(value)) return null;
  const entries = value.filter((entry) => typeof entry === 'string' && entry !== '');
  return entries.length > 0 ? JSON.stringify(entries) : null;
}

export function normalizeTags(tags: string[] | undefined): string | null {
  return normalizeStringArray(Array.isArray(tags) ? [...new Set(tags)] : tags);
}

export function normalizeAnnotations(
  annotations: ReportTest['annotations'] | undefined
): string | null {
  if (!Array.isArray(annotations)) return null;
  const byKey = new Map<string, { type: string; description?: string }>();
  for (const annotation of annotations) {
    if (typeof annotation?.type !== 'string' || annotation.type === '') continue;
    const description =
      typeof annotation.description === 'string' ? annotation.description : undefined;
    const entry = description ? { type: annotation.type, description } : { type: annotation.type };
    byKey.set(`${entry.type}:${description ?? ''}`, entry);
  }
  return byKey.size > 0 ? JSON.stringify([...byKey.values()]) : null;
}

import {
  CLEANUP_KINDS,
  CLEANUP_RULES,
  type CleanupEstimate,
  type CleanupKind,
  type CronConfig,
  cleanupDays,
  formatBytes,
  isCleanupConfirmed,
} from '@playwright-reports/shared';

export const CLEANUP_ESTIMATES_KEY = '/api/config/cleanup-estimates';

export function cleanupDepth(kind: CleanupKind): number {
  const container = CLEANUP_RULES[kind].containedBy;
  return container ? 1 + cleanupDepth(container) : 0;
}

export const ROW_ORDER: CleanupKind[] = [
  ...CLEANUP_KINDS.filter((kind) => kind !== 'results').sort(
    (a, b) => cleanupDepth(a) - cleanupDepth(b)
  ),
  'results',
];

export function describeEstimate(kind: CleanupKind, estimate: CleanupEstimate | undefined): string {
  if (!estimate) return 'Not calculated yet';
  if (estimate.affectedRows === 0) return 'Nothing to delete yet';

  const parts: string[] = [];
  if (estimate.bytes) parts.push(formatBytes(estimate.bytes));
  if (estimate.items !== undefined) parts.push(`${estimate.items.toLocaleString()} files`);
  parts.push(
    `${estimate.affectedRows.toLocaleString()} ${kind === 'results' ? 'results' : 'reports'}`
  );
  if (estimate.testRuns) parts.push(`${estimate.testRuns.toLocaleString()} test runs`);
  if (estimate.analyses) parts.push(`${estimate.analyses.toLocaleString()} LLM analyses`);
  return parts.join(' · ');
}

export function cleanupSummary(cron: CronConfig): string {
  const deleting = CLEANUP_KINDS.filter((kind) => isCleanupConfirmed(cron, kind)).map((kind) => {
    const days = cleanupDays(cron, kind);
    return kind === 'reports'
      ? `reports and their history after ${days} days`
      : `${CLEANUP_RULES[kind].label.toLowerCase()} after ${days} days`;
  });

  const awaiting = CLEANUP_KINDS.filter(
    (kind) => cleanupDays(cron, kind) !== undefined && !isCleanupConfirmed(cron, kind)
  ).length;
  const pending = awaiting > 0 ? ` ${awaiting} rule(s) await confirmation and delete nothing.` : '';

  if (deleting.length === 0) return `Nothing is deleted.${pending}`;
  return `Deletes ${deleting.join(', ')}.${pending}`;
}

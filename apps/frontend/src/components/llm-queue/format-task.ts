import {
  formatDuration as formatDurationMs,
  parseSqliteTimestamp,
} from '@playwright-reports/shared';

import { withBase } from '@/lib/url';

export const TYPE_SHORT_LABEL: Record<string, string> = {
  test_analysis: 'Test',
  report_summary: 'Report',
  project_summary: 'Project',
};

export function buildServedTestUrl(reportId: string, testId?: string): string {
  const base = withBase(`/api/serve/${reportId}/index.html`);
  return testId ? `${base}#?testId=${encodeURIComponent(testId)}` : base;
}

export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

export function statusBadgeVariant(status: string) {
  switch (status) {
    case 'queued':
      return 'secondary';
    case 'processing':
      return 'running';
    case 'completed':
      return 'success';
    case 'failed':
      return 'failure';
    case 'cancelled':
      return 'skipped';
    default:
      return 'outline';
  }
}

export function formatDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt || !completedAt) return '-';
  const ms = Math.max(0, parseSqliteTimestamp(completedAt) - parseSqliteTimestamp(startedAt));
  return formatDurationMs(ms);
}

export const PAGE_SIZE = 25;

export const STATUS_OPTIONS = [
  'all',
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled',
] as const;

export const TYPE_OPTIONS = ['all', 'test_analysis', 'report_summary', 'project_summary'] as const;

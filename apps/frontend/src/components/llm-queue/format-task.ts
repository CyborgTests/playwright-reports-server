import {
  formatDuration as formatDurationMs,
  parseSqliteTimestamp,
  STRATEGY_LABELS,
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

export const STRATEGY_LABEL: Record<string, string> = STRATEGY_LABELS;

export const ROLE_LABEL: Record<string, string> = {
  author: 'Author',
  synthesizer: 'Synthesizer',
  judge: 'Judge',
  critic: 'Critic',
  reviser: 'Reviser',
  tier: 'Tier',
  scorer: 'Scorer',
  screenshot_parser: 'Screenshot',
  fallback: 'Fallback',
};

export function isMultiRoleStrategy(strategy?: string | null): boolean {
  return !!strategy && strategy !== 'one_shot';
}

export interface ModelRate {
  inputCostPerMTok?: number;
  outputCostPerMTok?: number;
}

const rateKey = (baseUrl?: string | null, model?: string | null) =>
  `${baseUrl ?? ''}|${model ?? ''}`;

export function buildRateMap(
  models: Array<{ baseUrl: string; model: string } & ModelRate>
): Map<string, ModelRate> {
  const map = new Map<string, ModelRate>();
  for (const m of models) {
    if (m.inputCostPerMTok != null || m.outputCostPerMTok != null) {
      map.set(rateKey(m.baseUrl, m.model), {
        inputCostPerMTok: m.inputCostPerMTok,
        outputCostPerMTok: m.outputCostPerMTok,
      });
    }
  }
  return map;
}

export function computeCost(
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
  baseUrl: string | null | undefined,
  model: string | null | undefined,
  rates: Map<string, ModelRate>
): number | null {
  const r = rates.get(rateKey(baseUrl, model));
  if (!r) return null;
  const inCost = ((inputTokens ?? 0) / 1_000_000) * (r.inputCostPerMTok ?? 0);
  const outCost = ((outputTokens ?? 0) / 1_000_000) * (r.outputCostPerMTok ?? 0);
  return inCost + outCost;
}

export function formatCost(value: number | null): string {
  if (value == null) return '-';
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

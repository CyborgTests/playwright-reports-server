import { getDatabase } from '../db.js';

export interface UsageTotals {
  tasks: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface UsageByType extends UsageTotals {
  type: string;
}

export interface UsageReuse {
  analyses: number;
  reused: number;
}

export interface UsageByModel extends UsageTotals {
  baseUrl: string;
  model: string;
}

export function getUsageStats(fromDate: string): {
  totals: UsageTotals;
  byType: Record<string, UsageByType>;
  reuse: UsageReuse;
} {
  const db = getDatabase();

  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS tasks,
         COALESCE(SUM(inputTokens), 0) AS inputTokens,
         COALESCE(SUM(outputTokens), 0) AS outputTokens,
         COALESCE(SUM(totalTokens), 0) AS totalTokens
       FROM llm_tasks
       WHERE status = 'completed' AND completedAt >= ?`
    )
    .get(fromDate) as UsageTotals;

  const byTypeRows = db
    .prepare(
      `SELECT
         type,
         COUNT(*) AS tasks,
         COALESCE(SUM(inputTokens), 0) AS inputTokens,
         COALESCE(SUM(outputTokens), 0) AS outputTokens,
         COALESCE(SUM(totalTokens), 0) AS totalTokens
       FROM llm_tasks
       WHERE status = 'completed' AND completedAt >= ?
       GROUP BY type`
    )
    .all(fromDate) as UsageByType[];

  const byType: Record<string, UsageByType> = {};
  for (const row of byTypeRows) byType[row.type] = row;

  const reuse = db
    .prepare(
      `SELECT
         COUNT(*) AS analyses,
         SUM(CASE WHEN reusedFromAnalysisId IS NOT NULL THEN 1 ELSE 0 END) AS reused
       FROM test_llm_analyses
       WHERE createdAt >= ?`
    )
    .get(fromDate) as UsageReuse;

  return { totals, byType, reuse };
}

export function getUsageByModel(fromDate: string): UsageByModel[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT
         COALESCE(baseUrl, '') AS baseUrl,
         COALESCE(model, '') AS model,
         COUNT(*) AS tasks,
         COALESCE(SUM(inputTokens), 0) AS inputTokens,
         COALESCE(SUM(outputTokens), 0) AS outputTokens,
         COALESCE(SUM(totalTokens), 0) AS totalTokens
       FROM llm_tasks
       WHERE status = 'completed' AND completedAt >= ?
       GROUP BY COALESCE(baseUrl, ''), COALESCE(model, '')
       ORDER BY totalTokens DESC`
    )
    .all(fromDate) as UsageByModel[];
}

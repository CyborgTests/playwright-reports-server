import { sql } from 'kysely';
import { getDatabase } from '../db.js';
import { getKysely } from '../kysely.js';

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
  const k = getKysely();
  const db = getDatabase();

  const totalsCompiled = k
    .selectFrom('llm_tasks')
    .select((eb) => [
      eb.fn.countAll<number>().as('tasks'),
      sql<number>`COALESCE(SUM(inputTokens), 0)`.as('inputTokens'),
      sql<number>`COALESCE(SUM(outputTokens), 0)`.as('outputTokens'),
      sql<number>`COALESCE(SUM(totalTokens), 0)`.as('totalTokens'),
    ])
    .where('status', '=', 'completed')
    .where('completedAt', '>=', fromDate)
    .compile();
  const totals = db.prepare(totalsCompiled.sql).get(...totalsCompiled.parameters) as UsageTotals;

  const byTypeCompiled = k
    .selectFrom('llm_tasks')
    .select((eb) => [
      'type',
      eb.fn.countAll<number>().as('tasks'),
      sql<number>`COALESCE(SUM(inputTokens), 0)`.as('inputTokens'),
      sql<number>`COALESCE(SUM(outputTokens), 0)`.as('outputTokens'),
      sql<number>`COALESCE(SUM(totalTokens), 0)`.as('totalTokens'),
    ])
    .where('status', '=', 'completed')
    .where('completedAt', '>=', fromDate)
    .groupBy('type')
    .compile();
  const byTypeRows = db
    .prepare(byTypeCompiled.sql)
    .all(...byTypeCompiled.parameters) as UsageByType[];

  const byType: Record<string, UsageByType> = {};
  for (const row of byTypeRows) byType[row.type] = row;

  const reuseCompiled = k
    .selectFrom('test_llm_analyses')
    .select((eb) => [
      eb.fn.countAll<number>().as('analyses'),
      sql<number>`SUM(CASE WHEN reusedFromAnalysisId IS NOT NULL THEN 1 ELSE 0 END)`.as('reused'),
    ])
    .where('createdAt', '>=', fromDate)
    .compile();
  const reuse = db.prepare(reuseCompiled.sql).get(...reuseCompiled.parameters) as UsageReuse;

  return { totals, byType, reuse };
}

export function getUsageByModel(fromDate: string): UsageByModel[] {
  const k = getKysely();
  const db = getDatabase();
  const compiled = k
    .selectFrom('llm_tasks')
    .select((eb) => [
      sql<string>`COALESCE(baseUrl, '')`.as('baseUrl'),
      sql<string>`COALESCE(model, '')`.as('model'),
      eb.fn.countAll<number>().as('tasks'),
      sql<number>`COALESCE(SUM(inputTokens), 0)`.as('inputTokens'),
      sql<number>`COALESCE(SUM(outputTokens), 0)`.as('outputTokens'),
      sql<number>`COALESCE(SUM(totalTokens), 0)`.as('totalTokens'),
    ])
    .where('status', '=', 'completed')
    .where('completedAt', '>=', fromDate)
    .groupBy(sql`COALESCE(baseUrl, ''), COALESCE(model, '')`)
    .orderBy('totalTokens', 'desc')
    .compile();
  return db.prepare(compiled.sql).all(...compiled.parameters) as UsageByModel[];
}

import type Database from 'better-sqlite3';
import { getDatabase } from './db.js';

const initiatedFailureSummaryDb = Symbol.for('playwright.reports.db.failureSummary');
const instance = globalThis as typeof globalThis & {
  [initiatedFailureSummaryDb]?: FailureSummaryDatabase;
};

export interface ErrorGroup {
  pattern: string;
  count: number;
  category: string;
  testIds: string[];
}

export interface FailureSummaryRow {
  reportId: string;
  project: string;
  totalFailures: number;
  categories: Record<string, number>;
  errorGroups: ErrorGroup[];
  llmSummary: string | null;
  createdAt: string;
  updatedAt: string | null;
}

interface FailureSummaryDbRow {
  reportId: string;
  project: string;
  totalFailures: number;
  categories: string;
  errorGroups: string;
  llmSummary: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export class FailureSummaryDatabase {
  private readonly db = getDatabase();

  private readonly upsertStmt: Database.Statement<
    [string, string, number, string, string, string]
  >;
  private readonly getStmt: Database.Statement<[string]>;
  private readonly updateLlmSummaryStmt: Database.Statement<[string, string, string]>;
  private readonly deleteStmt: Database.Statement<[string]>;

  private constructor() {
    this.upsertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO report_failure_summaries (reportId, project, totalFailures, categories, errorGroups, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.getStmt = this.db.prepare(`
      SELECT * FROM report_failure_summaries WHERE reportId = ?
    `);

    this.updateLlmSummaryStmt = this.db.prepare(`
      UPDATE report_failure_summaries SET llmSummary = ?, updatedAt = ? WHERE reportId = ?
    `);

    this.deleteStmt = this.db.prepare(`
      DELETE FROM report_failure_summaries WHERE reportId = ?
    `);
  }

  public static getInstance(): FailureSummaryDatabase {
    instance[initiatedFailureSummaryDb] ??= new FailureSummaryDatabase();
    return instance[initiatedFailureSummaryDb];
  }

  private parseRow(row: FailureSummaryDbRow): FailureSummaryRow {
    return {
      ...row,
      categories: JSON.parse(row.categories) as Record<string, number>,
      errorGroups: JSON.parse(row.errorGroups) as ErrorGroup[],
    };
  }

  public upsertSummary(
    reportId: string,
    project: string,
    totalFailures: number,
    categories: Record<string, number>,
    errorGroups: ErrorGroup[]
  ): void {
    const now = new Date().toISOString();
    this.upsertStmt.run(
      reportId,
      project,
      totalFailures,
      JSON.stringify(categories),
      JSON.stringify(errorGroups),
      now
    );
  }

  public getSummary(reportId: string): FailureSummaryRow | null {
    const row = this.getStmt.get(reportId) as FailureSummaryDbRow | undefined;
    if (!row) return null;
    return this.parseRow(row);
  }

  public updateLlmSummary(reportId: string, llmSummary: string): void {
    const now = new Date().toISOString();
    this.updateLlmSummaryStmt.run(llmSummary, now, reportId);
  }

  /**
   * Get the latest N reports that had failures within the last `days` days.
   * Returns empty array if no failures in the time window (= "good job, no failures").
   */
  public getSummariesByProject(project?: string, limit = 10, days = 30): FailureSummaryRow[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString();

    let rows: FailureSummaryDbRow[];
    if (project && project !== 'all') {
      rows = this.db
        .prepare('SELECT * FROM report_failure_summaries WHERE project = ? AND totalFailures > 0 AND datetime(createdAt) >= datetime(?) ORDER BY createdAt DESC LIMIT ?')
        .all(project, cutoffStr, limit) as FailureSummaryDbRow[];
    } else {
      rows = this.db
        .prepare('SELECT * FROM report_failure_summaries WHERE totalFailures > 0 AND datetime(createdAt) >= datetime(?) ORDER BY createdAt DESC LIMIT ?')
        .all(cutoffStr, limit) as FailureSummaryDbRow[];
    }
    return rows.map((row) => this.parseRow(row));
  }

  public deleteSummary(reportId: string): void {
    this.deleteStmt.run(reportId);
  }

  public getAggregatedCategories(
    project?: string,
    limit = 10
  ): { categories: Array<{ category: string; count: number; percentage: number }>; totalFailures: number; topErrors: Array<{ message: string; category: string; count: number; signature: string }> } {
    const summaries = this.getSummariesByProject(project, limit);
    const categoryCounts: Record<string, number> = {};
    const errorMap = new Map<string, { message: string; category: string; count: number; signature: string }>();

    for (const summary of summaries) {
      for (const [category, count] of Object.entries(summary.categories)) {
        categoryCounts[category] = (categoryCounts[category] ?? 0) + count;
      }
      for (const group of summary.errorGroups) {
        const sig = group.pattern || '';
        const existing = errorMap.get(sig);
        if (existing) {
          existing.count += group.count;
        } else {
          errorMap.set(sig, {
            message: group.pattern || '',
            category: group.category,
            count: group.count,
            signature: sig,
          });
        }
      }
    }

    const totalFailures = Object.values(categoryCounts).reduce((s, c) => s + c, 0);
    const categories = Object.entries(categoryCounts)
      .map(([category, count]) => ({
        category,
        count,
        percentage: totalFailures > 0 ? (count / totalFailures) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const topErrors = Array.from(errorMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return { categories, totalFailures, topErrors };
  }
}

export const failureSummaryDb = FailureSummaryDatabase.getInstance();

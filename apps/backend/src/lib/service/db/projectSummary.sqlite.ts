import type Database from 'better-sqlite3';
import { getDatabase } from './db.js';

import { singletonOf } from './singleton.js';
export interface ProjectSummaryRow {
  project: string;
  summary: string;
  /** JSON-serialized structured analysis. Parsed by the route handler before sending to the UI. */
  structured: string | null;
  model: string | null;
  lastReportId: string | null;
  reportCount: number | null;
  firstReportAt: string | null;
  lastReportAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Persists per-project LLM failure summaries so they survive page refreshes.
 * Cached by `project` only — date range is intentionally not part of the key
 * because relative ranges ("today", "last 7 days") shift daily and would
 * invalidate the cache on calendar rollover. The cache is invalidated when a
 * new report for the project is ingested.
 *
 * To signal *which period* a cached summary actually covers, the row carries
 * `reportCount` + `firstReportAt`/`lastReportAt` of the reports that fed the
 * generation. The UI uses this so the user can see when the cached summary
 * looks at an older window than what's currently selected.
 */
export class ProjectSummaryDatabase {
  private readonly db = getDatabase();

  private readonly upsertStmt: Database.Statement<
    [
      string,
      string,
      string | null,
      string | null,
      string | null,
      number | null,
      string | null,
      string | null,
      string,
      string,
    ]
  >;
  private readonly getStmt: Database.Statement<[string]>;
  private readonly deleteByProjectStmt: Database.Statement<[string]>;

  constructor() {
    this.upsertStmt = this.db.prepare(`
      INSERT INTO project_llm_summaries
        (project, summary, structured, model, lastReportId, reportCount, firstReportAt, lastReportAt, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (project) DO UPDATE SET
        summary = excluded.summary,
        structured = excluded.structured,
        model = excluded.model,
        lastReportId = excluded.lastReportId,
        reportCount = excluded.reportCount,
        firstReportAt = excluded.firstReportAt,
        lastReportAt = excluded.lastReportAt,
        updatedAt = excluded.updatedAt
    `);

    this.getStmt = this.db.prepare(`
      SELECT * FROM project_llm_summaries WHERE project = ?
    `);

    this.deleteByProjectStmt = this.db.prepare(`
      DELETE FROM project_llm_summaries WHERE project = ?
    `);
  }

  public get(project: string): ProjectSummaryRow | null {
    const row = this.getStmt.get(project) as ProjectSummaryRow | undefined;
    return row ?? null;
  }

  public upsert(opts: {
    project: string;
    summary: string;
    structured?: string | null;
    model?: string;
    lastReportId?: string;
    reportCount?: number;
    firstReportAt?: string;
    lastReportAt?: string;
  }): void {
    const now = new Date().toISOString();
    this.upsertStmt.run(
      opts.project,
      opts.summary,
      opts.structured ?? null,
      opts.model ?? null,
      opts.lastReportId ?? null,
      opts.reportCount ?? null,
      opts.firstReportAt ?? null,
      opts.lastReportAt ?? null,
      now,
      now
    );
  }

  public deleteByProject(project: string): void {
    this.deleteByProjectStmt.run(project);
  }
}

export const projectSummaryDb = singletonOf('projectSummary', () => new ProjectSummaryDatabase());

import type { ProjectAnalysisStructured } from '@playwright-reports/shared';
import {
  linkifyProjectAnalysisStructured,
  linkifyReportRefs,
} from '../../llm/linkifyReportRefs.js';
import { getDatabase } from './db.js';
import { getKysely, type ProjectLlmSummariesRow } from './kysely.js';

import { singletonOf } from './singleton.js';
import { parseJsonColumn } from './utils.js';

export type ProjectSummaryRow = ProjectLlmSummariesRow;

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
  private readonly k = getKysely();
  private readonly db = getDatabase();

  public get(project: string): ProjectSummaryRow | null {
    const compiled = this.k
      .selectFrom('project_llm_summaries')
      .selectAll()
      .where('project', '=', project)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | ProjectSummaryRow
      | undefined;
    return row ?? null;
  }

  public upsert(opts: {
    project: string;
    summary: string;
    structured?: ProjectAnalysisStructured | string | null;
    model?: string;
    lastReportId?: string;
    reportCount?: number;
    firstReportAt?: string;
    lastReportAt?: string;
  }): void {
    const now = new Date().toISOString();
    const ctx = { project: opts.project === 'all' ? undefined : opts.project };
    const linkifiedSummary = linkifyReportRefs(opts.summary, ctx);
    let structuredJson: string | null = null;
    if (opts.structured) {
      const obj =
        typeof opts.structured === 'string'
          ? parseJsonColumn<ProjectAnalysisStructured | null>(opts.structured, null)
          : opts.structured;
      if (obj) structuredJson = JSON.stringify(linkifyProjectAnalysisStructured(obj, ctx));
    }
    const compiled = this.k
      .insertInto('project_llm_summaries')
      .values({
        project: opts.project,
        summary: linkifiedSummary,
        structured: structuredJson,
        model: opts.model ?? null,
        lastReportId: opts.lastReportId ?? null,
        reportCount: opts.reportCount ?? null,
        firstReportAt: opts.firstReportAt ?? null,
        lastReportAt: opts.lastReportAt ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflict((oc) =>
        oc.column('project').doUpdateSet((eb) => ({
          summary: eb.ref('excluded.summary'),
          structured: eb.ref('excluded.structured'),
          model: eb.ref('excluded.model'),
          lastReportId: eb.ref('excluded.lastReportId'),
          reportCount: eb.ref('excluded.reportCount'),
          firstReportAt: eb.ref('excluded.firstReportAt'),
          lastReportAt: eb.ref('excluded.lastReportAt'),
          updatedAt: eb.ref('excluded.updatedAt'),
        }))
      )
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public deleteByProject(project: string): void {
    const compiled = this.k
      .deleteFrom('project_llm_summaries')
      .where('project', '=', project)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }
}

export const projectSummaryDb = singletonOf('projectSummary', () => new ProjectSummaryDatabase());

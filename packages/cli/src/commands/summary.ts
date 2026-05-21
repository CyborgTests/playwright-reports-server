import { apiGet } from '../client.js';
import { resolveConfig } from '../config.js';
import { emitJson } from '../format.js';
import type { ProjectSummary, ReportSummary } from '../types.js';

export async function runReportSummary(reportId: string): Promise<void> {
  if (!reportId) {
    throw new Error('Usage: pwrs-cli report summary <reportId>');
  }
  const config = resolveConfig();
  const summary = await apiGet<ReportSummary>(
    config,
    `/api/cli/report/${encodeURIComponent(reportId)}/summary`
  );
  emitJson(summary);
}

interface ProjectSummaryOpts {
  project?: string;
}

/**
 * Persisted LLM project summary (the dashboard's "Project Health" card).
 * `--project all` (or omitting --project) returns the cross-project summary.
 */
export async function runProjectSummary(opts: ProjectSummaryOpts): Promise<void> {
  const config = resolveConfig();
  const projectKey = opts.project && opts.project.length > 0 ? opts.project : 'all';
  const summary = await apiGet<ProjectSummary>(
    config,
    `/api/cli/project/${encodeURIComponent(projectKey)}/summary`
  );
  emitJson(summary);
}

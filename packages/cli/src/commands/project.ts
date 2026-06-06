import { apiGet, apiPost } from '../client.js';
import { resolveConfig } from '../config.js';
import { emitJson } from '../format.js';
import { readJsonInput, readTextInput } from '../input.js';

export async function runProjectList(): Promise<void> {
  const config = resolveConfig();
  const projects = await apiGet<string[]>(config, '/api/report/projects');
  emitJson({ projects });
}

interface ProjectSummarySubmitOpts {
  project?: string;
  summaryFile?: string;
  structuredFile?: string;
  model: string;
  lastReportId?: string;
  reportCount?: number;
  firstReportAt?: string;
  lastReportAt?: string;
  force?: boolean;
}

export async function runProjectSummarySubmit(opts: ProjectSummarySubmitOpts): Promise<void> {
  const project = opts.project ?? 'all';
  const summary = await readTextInput(opts.summaryFile, { label: 'summary' });
  const structured = await readJsonInput<unknown>(opts.structuredFile, { label: 'structured' });
  const config = resolveConfig();
  const data = await apiPost<unknown>(
    config,
    `/api/cli/project/${encodeURIComponent(project)}/summary`,
    {
      summary,
      structured,
      model: opts.model,
      lastReportId: opts.lastReportId,
      reportCount: opts.reportCount,
      firstReportAt: opts.firstReportAt,
      lastReportAt: opts.lastReportAt,
      force: opts.force ? true : undefined,
    }
  );
  emitJson(data);
}

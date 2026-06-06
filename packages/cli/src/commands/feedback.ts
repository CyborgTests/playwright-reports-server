import { apiDelete, apiPut } from '../client.js';
import { resolveConfig } from '../config.js';
import { emitJson } from '../format.js';

interface FeedbackUpsertOpts {
  comment: string;
  reportId?: string;
  fileId?: string;
  project?: string;
}

interface FeedbackClearOpts {
  reportId?: string;
  fileId?: string;
  project?: string;
}

export async function runTestFeedbackUpsert(
  testId: string,
  opts: FeedbackUpsertOpts
): Promise<void> {
  if (!testId) {
    throw new Error(
      'Usage: pwrs-cli test feedback <testId> --comment "..." [--report-id <id>] [--file-id <id>] [--project <p>]'
    );
  }
  if (!opts.comment.trim()) {
    throw new Error('--comment must be non-empty');
  }
  if (!opts.reportId && !(opts.fileId && opts.project)) {
    throw new Error('Provide --report-id, or both --file-id and --project');
  }
  const config = resolveConfig();
  const data = await apiPut<unknown>(config, '/api/llm/feedback', {
    testId,
    comment: opts.comment,
    reportId: opts.reportId,
    fileId: opts.fileId,
    project: opts.project,
  });
  emitJson(data);
}

export async function runTestFeedbackClear(testId: string, opts: FeedbackClearOpts): Promise<void> {
  if (!testId) {
    throw new Error(
      'Usage: pwrs-cli test feedback-clear <testId> [--report-id <id>] [--file-id <id>] [--project <p>]'
    );
  }
  if (!opts.reportId && !(opts.fileId && opts.project)) {
    throw new Error('Provide --report-id, or both --file-id and --project');
  }
  const config = resolveConfig();
  const data = await apiDelete<unknown>(config, '/api/llm/feedback', {
    testId,
    reportId: opts.reportId,
    fileId: opts.fileId,
    project: opts.project,
  });
  emitJson(data);
}

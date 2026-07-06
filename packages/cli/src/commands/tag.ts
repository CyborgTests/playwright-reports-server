import { apiGet } from '../client.js';
import { resolveConfig } from '../config.js';
import { emitJson } from '../format.js';

interface TagListOpts {
  project?: string;
}

export async function runTagList(opts: TagListOpts): Promise<void> {
  const config = resolveConfig();
  const tags = await apiGet<string[]>(config, '/api/report/tags', { project: opts.project });
  emitJson({ tags });
}

import { apiGet } from '../client.js';
import { resolveConfig } from '../config.js';
import { emitJson } from '../format.js';
import type { FailureCategoriesResponse } from '../types.js';

interface CategoryListOpts {
  project?: string;
}

/**
 * Enumerate failure categories the heuristic has emitted. Use this to pick a
 * valid value for `test search --failure-category` rather than guessing
 * 'timeout' vs 'Timeout' vs 'navigation_error'. Pass `--project <p>` to scope
 * - categories may differ across projects.
 */
export async function runCategoryList(opts: CategoryListOpts = {}): Promise<void> {
  const config = resolveConfig();
  const data = await apiGet<FailureCategoriesResponse>(
    config,
    '/api/cli/categories',
    opts.project ? { project: opts.project } : {}
  );
  emitJson(data);
}

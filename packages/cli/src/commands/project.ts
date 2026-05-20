import { apiGet } from '../client.js';
import { resolveConfig } from '../config.js';
import { emitJson } from '../format.js';

export async function runProjectList(): Promise<void> {
  const config = resolveConfig();
  const projects = await apiGet<string[]>(config, '/api/report/projects');
  emitJson({ projects });
}

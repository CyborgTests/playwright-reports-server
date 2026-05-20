import type { ResolvedConfig } from './config.js';

export class CliHttpError extends Error {
  constructor(
    public status: number,
    public body: string,
    public url: string
  ) {
    super(`HTTP ${status} ${url}: ${body.slice(0, 200)}`);
    this.name = 'CliHttpError';
  }
}

export interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Minimal HTTP client. Speaks the server's `{ success, data }` envelope and
 * unwraps it so callers get the inner payload. Bearer auth uses the same
 * API_TOKEN scheme that the reporter package uses.
 */
export async function apiGet<T>(
  config: ResolvedConfig,
  path: string,
  query: Record<string, string | number | undefined> = {}
): Promise<T> {
  const url = buildUrl(config.server, path, query);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;

  const response = await fetch(url, { headers });
  const text = await response.text();
  if (!response.ok) {
    throw new CliHttpError(response.status, text, url);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CliHttpError(response.status, `Invalid JSON: ${text.slice(0, 200)}`, url);
  }

  if (
    parsed &&
    typeof parsed === 'object' &&
    'success' in parsed &&
    (parsed as ApiEnvelope<T>).success === false
  ) {
    throw new CliHttpError(
      response.status,
      (parsed as ApiEnvelope<T>).error ?? 'Request failed',
      url
    );
  }
  if (parsed && typeof parsed === 'object' && 'data' in parsed) {
    return (parsed as ApiEnvelope<T>).data as T;
  }
  return parsed as T;
}

function buildUrl(
  server: string,
  path: string,
  query: Record<string, string | number | undefined>
): string {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, server);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

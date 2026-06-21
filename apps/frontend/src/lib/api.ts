import { authHeaders } from './auth';
import { withBase } from './url';

export const errMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  for (const [k, v] of Object.entries(authHeaders() as Record<string, string>)) {
    headers.set(k, v);
  }
  if (typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(withBase(path), { ...options, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(text || res.statusText);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

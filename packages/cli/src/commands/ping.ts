import { apiGet } from '../client.js';
import { resolveConfig } from '../config.js';
import { emitJson } from '../format.js';

interface PingResponse {
  status: string;
  timestamp: string;
}

/**
 * Sanity-check that the configured server is reachable and that the saved
 * token (if any) is accepted. Returns `{ ok, server, latencyMs, status,
 * timestamp }` so an agent can confirm config without issuing a real query.
 */
export async function runPing(): Promise<void> {
  const config = resolveConfig();
  const start = Date.now();
  const res = await apiGet<PingResponse>(config, '/api/ping');
  const latencyMs = Date.now() - start;
  emitJson({
    ok: res.status === 'ok',
    server: config.server,
    tokenConfigured: Boolean(config.token),
    latencyMs,
    status: res.status,
    timestamp: res.timestamp,
  });
}

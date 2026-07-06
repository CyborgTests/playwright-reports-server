import {
  type ChannelTemplate,
  defaultEventTemplate,
  defaultScheduleTemplate,
  type NotificationChannel,
  type NotificationRule,
} from '@playwright-reports/shared';
import { recordFailure, recordSuccess } from '../circuitBreaker.js';
import type { DispatchResult } from './types.js';

const PER_ATTEMPT_TIMEOUT_MS = 5_000;
const BACKOFFS_MS = [1_000, 4_000];

export function resolveTemplate(
  rule: NotificationRule,
  channel: NotificationChannel
): ChannelTemplate {
  if (rule.template) return rule.template;
  if (rule.kind === 'event') return defaultEventTemplate(channel.type, rule.condition);
  return defaultScheduleTemplate(channel.type, rule.condition);
}

interface AttemptResult {
  ok: boolean;
  status?: number;
  error: string;
  retryAfterMs?: number;
}

async function attempt(
  doFetch: (signal: AbortSignal) => Promise<Response>
): Promise<AttemptResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);
  try {
    const response = await doFetch(controller.signal);
    if (response.ok) return { ok: true, status: response.status, error: '' };

    const text = await response.text().catch(() => '');
    const trimmed = text.slice(0, 200).trim() || `HTTP ${response.status}`;

    let retryAfterMs: number | undefined;
    const retryAfter = response.headers.get('Retry-After');
    if (retryAfter) {
      const secs = Number.parseInt(retryAfter, 10);
      if (Number.isFinite(secs) && secs > 0) retryAfterMs = secs * 1000;
    }
    return { ok: false, status: response.status, error: trimmed, retryAfterMs };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      error: isAbort
        ? `Timed out after ${PER_ATTEMPT_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries on network/5xx with backoff (honouring Retry-After); 4xx fails fast.
// Records circuit-breaker success/failure for the channel.
export async function postWithRetry(
  channelId: string,
  doFetch: (signal: AbortSignal) => Promise<Response>
): Promise<DispatchResult> {
  let attempts = 0;
  let lastError = '';
  let lastStatus: number | undefined;

  const totalAttempts = 1 + BACKOFFS_MS.length;
  for (let i = 0; i < totalAttempts; i++) {
    attempts = i + 1;
    const result = await attempt(doFetch);

    if (result.ok) {
      recordSuccess(channelId);
      return { ok: true, attempts, httpStatus: result.status };
    }

    lastError = result.error;
    lastStatus = result.status;

    if (result.status !== undefined && result.status >= 400 && result.status < 500) {
      return { ok: false, attempts, httpStatus: lastStatus, error: lastError };
    }

    if (i === totalAttempts - 1) break;
    await sleep(result.retryAfterMs ?? BACKOFFS_MS[i]);
  }

  recordFailure(channelId);
  return { ok: false, attempts, httpStatus: lastStatus, error: lastError };
}

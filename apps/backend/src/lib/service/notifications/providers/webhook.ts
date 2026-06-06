import { createHmac } from 'node:crypto';
import {
  type ChannelTemplate,
  defaultEventTemplate,
  defaultScheduleTemplate,
  jsonValueEscape,
  type NotificationChannel,
  type NotificationRule,
  renderTemplate,
  type WebhookChannelConfig,
} from '@playwright-reports/shared';
import { isOpen, recordFailure, recordSuccess } from '../circuitBreaker.js';
import type { DispatchInput, DispatchResult } from './types.js';

const PER_ATTEMPT_TIMEOUT_MS = 5_000;
const BACKOFFS_MS = [1_000, 4_000];

export async function sendWebhook(input: DispatchInput): Promise<DispatchResult> {
  const { channel, rule, context, allowlist } = input;
  if (channel.type !== 'webhook') {
    return {
      ok: false,
      attempts: 0,
      error: `Wrong provider for channel type "${channel.type}"`,
    };
  }
  if (isOpen(channel.id)) {
    return { ok: false, attempts: 0, skipReason: 'circuit_open' };
  }

  const template = resolveTemplate(rule, channel);
  if (template.provider !== 'webhook') {
    return {
      ok: false,
      attempts: 0,
      error: 'Template provider does not match channel type',
    };
  }

  const rendered = renderTemplate(template.bodyJson, context, {
    allowlist,
    transform: jsonValueEscape,
  });

  try {
    JSON.parse(rendered.output);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      attempts: 0,
      error: `Rendered body is not valid JSON: ${message.slice(0, 200)}`,
    };
  }

  const cfg = channel.config as WebhookChannelConfig;
  return runWithRetry(channel.id, cfg, rendered.output);
}

function resolveTemplate(rule: NotificationRule, channel: NotificationChannel): ChannelTemplate {
  if (rule.template) return rule.template;
  if (rule.kind === 'event') return defaultEventTemplate(channel.type, rule.condition);
  return defaultScheduleTemplate(channel.type, rule.condition);
}

async function runWithRetry(
  channelId: string,
  cfg: WebhookChannelConfig,
  body: string
): Promise<DispatchResult> {
  let attempts = 0;
  let lastError = '';
  let lastStatus: number | undefined;

  const totalAttempts = 1 + BACKOFFS_MS.length;
  for (let i = 0; i < totalAttempts; i++) {
    attempts = i + 1;
    const result = await attempt(cfg, body);

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

    const wait = result.retryAfterMs ?? BACKOFFS_MS[i];
    await sleep(wait);
  }

  recordFailure(channelId);
  return { ok: false, attempts, httpStatus: lastStatus, error: lastError };
}

interface AttemptResult {
  ok: boolean;
  status?: number;
  error: string;
  retryAfterMs?: number;
}

async function attempt(cfg: WebhookChannelConfig, body: string): Promise<AttemptResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      ...cfg.headers,
    };
    if (cfg.secretHmacKey) {
      const hex = createHmac('sha256', cfg.secretHmacKey).update(body, 'utf8').digest('hex');
      headers['X-PWRS-Signature'] = `sha256=${hex}`;
    }

    const response = await fetch(cfg.url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    if (response.ok) {
      return { ok: true, status: response.status, error: '' };
    }

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

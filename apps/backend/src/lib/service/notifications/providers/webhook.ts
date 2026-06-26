import { createHmac } from 'node:crypto';
import {
  jsonValueEscape,
  renderTemplate,
  type WebhookChannelConfig,
} from '@playwright-reports/shared';
import { isOpen } from '../circuitBreaker.js';
import { postWithRetry, resolveTemplate } from './shared.js';
import type { DispatchInput, DispatchResult } from './types.js';

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
  const body = rendered.output;
  return postWithRetry(channel.id, (signal) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      ...cfg.headers,
    };
    if (cfg.secretHmacKey) {
      const hex = createHmac('sha256', cfg.secretHmacKey).update(body, 'utf8').digest('hex');
      headers['X-PWRS-Signature'] = `sha256=${hex}`;
    }
    return fetch(cfg.url, { method: 'POST', headers, body, signal });
  });
}

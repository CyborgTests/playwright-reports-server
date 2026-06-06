import type {
  ChannelTemplate,
  NotificationChannel,
  SlackBlock,
  SlackChannelConfig,
} from '@playwright-reports/shared';
import {
  defaultEventTemplate,
  defaultScheduleTemplate,
  renderTemplate,
} from '@playwright-reports/shared';
import { isOpen, recordFailure, recordSuccess } from '../circuitBreaker.js';
import type { DispatchInput, DispatchResult } from './types.js';

const PER_ATTEMPT_TIMEOUT_MS = 5_000;
const BACKOFFS_MS = [1_000, 4_000];
const HEADER_MAX = 150;
const MUSTACHE_LEFTOVER = /\{\{[^}]+\}\}/;

function isAbsoluteHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

type BlockKitBlock =
  | { type: 'header'; text: { type: 'plain_text'; text: string; emoji: boolean } }
  | { type: 'section'; text: { type: 'mrkdwn'; text: string } }
  | { type: 'divider' }
  | { type: 'context'; elements: Array<{ type: 'mrkdwn'; text: string }> }
  | {
      type: 'actions';
      elements: Array<{
        type: 'button';
        text: { type: 'plain_text'; text: string; emoji: boolean };
        url: string;
      }>;
    }
  | { type: 'image'; image_url: string; alt_text: string };

export async function sendSlack(input: DispatchInput): Promise<DispatchResult> {
  const { channel, rule, context, allowlist } = input;
  if (channel.type !== 'slack') {
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
  if (template.provider !== 'slack') {
    return {
      ok: false,
      attempts: 0,
      error: 'Template provider does not match channel type',
    };
  }

  const blocks = renderBlocks(template.blocks, context, allowlist);
  if (blocks.length === 0) {
    return {
      ok: false,
      attempts: 0,
      skipReason: 'empty_render',
    };
  }

  const slackConfig = channel.config as SlackChannelConfig;
  const body = JSON.stringify({ blocks });

  return runWithRetry(channel.id, slackConfig.webhookUrl, body);
}

function resolveTemplate(
  rule: NotificationChannel['rules'][number],
  channel: NotificationChannel
): ChannelTemplate {
  if (rule.template) return rule.template;
  if (rule.kind === 'event') return defaultEventTemplate(channel.type, rule.condition);
  return defaultScheduleTemplate(channel.type, rule.condition);
}

function renderBlocks(
  template: SlackBlock[],
  context: Record<string, unknown>,
  allowlist: ReadonlySet<string>
): BlockKitBlock[] {
  const render = (input: string) => renderTemplate(input, context, { allowlist }).output;

  const out: BlockKitBlock[] = [];
  for (const block of template) {
    if (block.type === 'header') {
      const text = render(block.text).slice(0, HEADER_MAX);
      if (!text.trim()) continue;
      out.push({ type: 'header', text: { type: 'plain_text', text, emoji: true } });
      continue;
    }
    if (block.type === 'section') {
      const text = render(block.text);
      if (!text.trim()) continue;
      out.push({ type: 'section', text: { type: 'mrkdwn', text } });
      continue;
    }
    if (block.type === 'divider') {
      out.push({ type: 'divider' });
      continue;
    }
    if (block.type === 'context') {
      const text = render(block.text);
      if (!text.trim()) continue;
      out.push({ type: 'context', elements: [{ type: 'mrkdwn', text }] });
      continue;
    }
    if (block.type === 'image') {
      const url = render(block.url);
      if (!url || MUSTACHE_LEFTOVER.test(url) || !isAbsoluteHttpUrl(url)) continue;
      const altText = block.altText ? render(block.altText) : '';
      out.push({ type: 'image', image_url: url, alt_text: altText });
      continue;
    }
    const elements: Array<{
      type: 'button';
      text: { type: 'plain_text'; text: string; emoji: boolean };
      url: string;
    }> = [];
    for (const btn of block.buttons) {
      const label = render(btn.label);
      const url = render(btn.url);
      if (!label.trim() || !url.trim() || MUSTACHE_LEFTOVER.test(url) || !isAbsoluteHttpUrl(url)) {
        continue;
      }
      elements.push({
        type: 'button',
        text: { type: 'plain_text', text: label, emoji: true },
        url,
      });
    }
    if (elements.length > 0) out.push({ type: 'actions', elements });
  }
  return out;
}

async function runWithRetry(
  channelId: string,
  webhookUrl: string,
  body: string
): Promise<DispatchResult> {
  let attempts = 0;
  let lastError = '';
  let lastStatus: number | undefined;

  const totalAttempts = 1 + BACKOFFS_MS.length;
  for (let i = 0; i < totalAttempts; i++) {
    attempts = i + 1;
    const result = await attempt(webhookUrl, body);

    if (result.ok) {
      recordSuccess(channelId);
      return { ok: true, attempts, httpStatus: result.status };
    }

    lastError = result.error;
    lastStatus = result.status;

    if (result.status !== undefined && result.status >= 400 && result.status < 500) {
      return {
        ok: false,
        attempts,
        httpStatus: lastStatus,
        error: lastError,
      };
    }

    if (i === totalAttempts - 1) break;

    const wait = result.retryAfterMs ?? BACKOFFS_MS[i];
    await sleep(wait);
  }

  recordFailure(channelId);
  return {
    ok: false,
    attempts,
    httpStatus: lastStatus,
    error: lastError,
  };
}

interface AttemptResult {
  ok: boolean;
  status?: number;
  error: string;
  retryAfterMs?: number;
}

async function attempt(url: string, body: string): Promise<AttemptResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
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
      if (Number.isFinite(secs) && secs > 0) {
        retryAfterMs = secs * 1000;
      }
    }

    return { ok: false, status: response.status, error: trimmed, retryAfterMs };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      error: isAbort ? `Timed out after ${PER_ATTEMPT_TIMEOUT_MS}ms` : describeError(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

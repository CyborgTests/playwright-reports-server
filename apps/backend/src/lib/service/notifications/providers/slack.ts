import type { SlackBlock, SlackChannelConfig } from '@playwright-reports/shared';
import { renderTemplate } from '@playwright-reports/shared';
import { isOpen } from '../circuitBreaker.js';
import { postWithRetry, resolveTemplate } from './shared.js';
import type { DispatchInput, DispatchResult } from './types.js';

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

  return postWithRetry(channel.id, (signal) =>
    fetch(slackConfig.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body,
      signal,
    })
  );
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

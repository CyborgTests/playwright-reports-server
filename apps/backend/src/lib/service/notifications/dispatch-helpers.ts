import { randomUUID } from 'node:crypto';
import type { NotificationChannel, NotificationRule } from '@playwright-reports/shared';
import { notificationLogDb } from '../db/index.js';
import { sendSlack } from './providers/slack.js';
import type { DispatchInput, DispatchResult } from './providers/types.js';
import { sendWebhook } from './providers/webhook.js';

export async function dispatchOne(
  channel: NotificationChannel,
  rule: NotificationRule,
  context: Record<string, unknown>,
  allowlist: ReadonlySet<string>
): Promise<DispatchResult> {
  const input: DispatchInput = { channel, rule, context, allowlist };
  try {
    if (channel.type === 'slack') return await sendSlack(input);
    if (channel.type === 'webhook') return await sendWebhook(input);
    return {
      ok: false,
      attempts: 0,
      error: `Unknown channel type: ${(channel as { type: string }).type}`,
    };
  } catch (err) {
    return {
      ok: false,
      attempts: 0,
      error: `Provider threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function writeLog(
  channel: NotificationChannel,
  rule: NotificationRule,
  result: DispatchResult,
  source: 'live' | 'test'
): void {
  try {
    const status: 'success' | 'failed' | 'skipped' = result.ok
      ? 'success'
      : result.skipReason
        ? 'skipped'
        : 'failed';
    notificationLogDb.insert({
      id: randomUUID(),
      channelId: channel.id,
      channelType: channel.type,
      ruleId: rule.id,
      ruleKind: rule.kind,
      event: rule.kind === 'event' ? rule.event : 'schedule',
      condition: rule.condition,
      status,
      skipReason: result.skipReason ?? null,
      httpStatus: result.httpStatus ?? null,
      error: result.error ?? null,
      attempt: result.attempts,
      source,
      createdAt: Date.now(),
    });
  } catch (err) {
    console.warn(
      `[notifications] failed to write delivery log entry: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

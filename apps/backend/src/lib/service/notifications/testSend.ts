import type {
  NotificationChannel,
  NotificationRule,
  NotificationsConfig,
  ScheduleRule,
} from '@playwright-reports/shared';
import { configCache } from '../cache/config.js';
import { reportDb } from '../db/reports.sqlite.js';
import { dispatchOne, writeLog } from './dispatch-helpers.js';
import type { DispatchResult } from './providers/types.js';
import { buildSummaryForProject, type WindowRange } from './schedule.js';
import {
  buildEventContext,
  buildScheduleContext,
  eventVariablesForCondition,
  type ReportLike,
  scheduleVariables,
} from './variables.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TestSendOptions {
  config: NotificationsConfig | undefined;
  channelId: string;
  ruleIds?: string[];
  rule?: NotificationRule;
  reportId?: string;
}

export interface TestSendResult {
  ruleId: string;
  result: DispatchResult;
}

export async function sendTest(opts: TestSendOptions): Promise<{
  ok: boolean;
  results: TestSendResult[];
  error?: string;
}> {
  const channel = opts.config?.channels.find((c) => c.id === opts.channelId);
  if (!channel) {
    return { ok: false, results: [], error: `Channel "${opts.channelId}" not found` };
  }

  const allRules = channel.rules;
  const ruleIds = opts.ruleIds;
  const rules: NotificationRule[] = opts.rule
    ? [opts.rule]
    : ruleIds && ruleIds.length > 0
      ? allRules.filter((r) => ruleIds.includes(r.id))
      : allRules;

  if (rules.length === 0) {
    return { ok: false, results: [], error: 'No rules to test on this channel' };
  }

  const report = opts.reportId ? reportDb.getByID(opts.reportId) : undefined;
  if (opts.reportId && !report) {
    return { ok: false, results: [], error: `Report "${opts.reportId}" not found` };
  }

  const results: TestSendResult[] = [];
  for (const rule of rules) {
    const result =
      rule.kind === 'event'
        ? await testEvent(channel, rule, report)
        : await testSchedule(channel, rule, report);
    writeLog(channel, rule, result, 'test');
    results.push({ ruleId: rule.id, result });
  }

  return { ok: results.every((r) => r.result.ok), results };
}

async function testEvent(
  channel: NotificationChannel,
  rule: NotificationRule,
  report: ReportLike | undefined
): Promise<DispatchResult> {
  if (rule.kind !== 'event') {
    return { ok: false, attempts: 0, error: 'Expected event rule' };
  }
  if (!report) {
    return { ok: false, attempts: 0, error: 'Event-rule test requires a report' };
  }

  const needsPrev =
    rule.condition === 'recovered_to_clean' || rule.condition === 'recovered_no_hard_failures';
  let previous: ReportLike | undefined;
  if (needsPrev) {
    const prevId = reportDb.getPreviousReportId(report.reportID);
    if (prevId) {
      previous = reportDb.getByID(prevId);
    }
  }

  const context = buildEventContext({
    report,
    previous,
    serverUrl: configCache.config?.serverBaseUrl ?? '',
  });
  const allowlist = eventVariablesForCondition(rule.condition);

  return dispatchOne(channel, rule, context, allowlist);
}

async function testSchedule(
  channel: NotificationChannel,
  rule: NotificationRule,
  report: ReportLike | undefined
): Promise<DispatchResult> {
  if (rule.kind !== 'schedule') {
    return { ok: false, attempts: 0, error: 'Expected schedule rule' };
  }

  const project =
    report?.project ?? (rule.projectFilter.mode === 'project' ? rule.projectFilter.name : 'all');

  const now = Date.now();
  const window: WindowRange = { start: now - DAY_MS, end: now, label: 'Last 24h (test)' };
  const scheduleRule = rule as ScheduleRule;
  const summary = buildSummaryForProject({ rule: scheduleRule, project, window });

  const context = buildScheduleContext({
    summary,
    serverUrl: configCache.config?.serverBaseUrl ?? '',
  });
  const allowlist = scheduleVariables();

  return dispatchOne(channel, rule, context, allowlist);
}

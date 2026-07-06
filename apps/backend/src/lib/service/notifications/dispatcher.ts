import type { NotificationChannel, NotificationsConfig } from '@playwright-reports/shared';
import { configCache } from '../cache/config.js';
import { regressionsDb, reportDb } from '../db/index.js';
import { dispatchOne, writeLog } from './dispatch-helpers.js';
import { projectFilterMatches } from './filters.js';
import type { DispatchResult } from './providers/types.js';
import {
  buildEventContext,
  type EventContext,
  eventConditionMatches,
  eventVariablesForCondition,
  type ReportLike,
} from './variables.js';

export interface DispatchedRule {
  channelId: string;
  ruleId: string;
  result: DispatchResult;
}

export async function dispatchReportUploaded(
  report: ReportLike,
  config: NotificationsConfig | undefined
): Promise<DispatchedRule[]> {
  if (!config?.enabled || config.channels.length === 0) return [];
  const enabledChannels = config.channels.filter((c) => c.enabled);
  if (enabledChannels.length === 0) return [];

  let prevLookup: 'unfetched' | 'absent' | ReportLike = 'unfetched';
  const getPrev = async (): Promise<ReportLike | undefined> => {
    if (prevLookup === 'absent') return undefined;
    if (prevLookup !== 'unfetched') return prevLookup;
    const prevId = reportDb.getPreviousReportId(report.reportID);
    if (!prevId) {
      prevLookup = 'absent';
      return undefined;
    }
    const prev = reportDb.getByID(prevId);
    prevLookup = prev ?? 'absent';
    return prev;
  };

  const regressionsForReport = regressionsDb.countsForReport(report.reportID);

  const tasks = enabledChannels.map((channel) =>
    runChannelRules(channel, report, getPrev, regressionsForReport)
  );
  const settled = await Promise.allSettled(tasks);

  const out: DispatchedRule[] = [];
  for (const [i, s] of settled.entries()) {
    const channel = enabledChannels[i];
    if (s.status === 'fulfilled') {
      out.push(...s.value);
      for (const dispatched of s.value) {
        if (!dispatched.result.ok && !dispatched.result.skipReason) {
          console.warn(
            `[notifications] channel "${channel.name}" rule ${dispatched.ruleId} for report ${report.reportID} failed: ${
              dispatched.result.error ?? 'unknown error'
            }${dispatched.result.httpStatus ? ` (HTTP ${dispatched.result.httpStatus})` : ''}`
          );
        }
      }
    } else {
      console.error(
        `[notifications] channel "${channel.name}" worker rejected: ${
          s.reason instanceof Error ? s.reason.message : String(s.reason)
        }`
      );
    }
  }
  return out;
}

async function runChannelRules(
  channel: NotificationChannel,
  report: ReportLike,
  getPrev: () => Promise<ReportLike | undefined>,
  regressionsForReport: { newHere: number; resolvedHere: number }
): Promise<DispatchedRule[]> {
  const results: DispatchedRule[] = [];
  let fired = false;

  for (const rule of channel.rules) {
    if (rule.kind !== 'event' || rule.event !== 'report_uploaded') continue;
    if (rule.enabled === false) continue;

    if (!projectFilterMatches(rule.projectFilter, report.project)) continue;

    const needsPrev =
      rule.condition === 'recovered_to_clean' || rule.condition === 'recovered_no_hard_failures';
    const previous = needsPrev ? await getPrev() : undefined;

    if (!eventConditionMatches(rule.condition, { report, previous, regressionsForReport }))
      continue;

    if (fired) {
      const dup: DispatchResult = { ok: false, attempts: 0, skipReason: 'duplicate' };
      writeLog(channel, rule, dup, 'live');
      results.push({ channelId: channel.id, ruleId: rule.id, result: dup });
      continue;
    }
    fired = true;

    const context: EventContext = buildEventContext({
      report,
      previous,
      serverUrl: configCache.config?.serverBaseUrl ?? '',
      regressionsForReport,
    });
    const allowlist = eventVariablesForCondition(rule.condition);

    const result = await dispatchOne(channel, rule, context, allowlist);
    writeLog(channel, rule, result, 'live');
    results.push({ channelId: channel.id, ruleId: rule.id, result });
  }

  return results;
}

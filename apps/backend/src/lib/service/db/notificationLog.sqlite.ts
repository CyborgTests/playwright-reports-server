import type { NotificationLogEntry } from '@playwright-reports/shared';
import { getDatabase } from './db.js';
import { getKysely, type NotificationLogRow } from './kysely.js';

import { singletonOf } from './singleton.js';

export interface NotificationLogQueryFilters {
  channelId?: string;
  status?: 'success' | 'failed' | 'skipped';
  source?: 'live' | 'test';
  limit: number;
  offset: number;
}

export class NotificationLogDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();

  public insert(entry: NotificationLogEntry): void {
    const compiled = this.k
      .insertInto('notification_log')
      .values({
        id: entry.id,
        channel_id: entry.channelId,
        channel_type: entry.channelType,
        rule_id: entry.ruleId,
        rule_kind: entry.ruleKind,
        event: entry.event,
        condition: entry.condition,
        status: entry.status,
        skip_reason: entry.skipReason ?? null,
        http_status: entry.httpStatus ?? null,
        error: entry.error ?? null,
        attempt: entry.attempt,
        source: entry.source,
        created_at: entry.createdAt,
      })
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public list(filters: NotificationLogQueryFilters): {
    rows: NotificationLogEntry[];
    total: number;
  } {
    let countQuery = this.k
      .selectFrom('notification_log')
      .select((eb) => eb.fn.countAll<number>().as('total'));
    if (filters.channelId) countQuery = countQuery.where('channel_id', '=', filters.channelId);
    if (filters.status) countQuery = countQuery.where('status', '=', filters.status);
    if (filters.source) countQuery = countQuery.where('source', '=', filters.source);
    const countCompiled = countQuery.compile();
    const totalRow = this.db.prepare(countCompiled.sql).get(...countCompiled.parameters) as {
      total: number;
    };

    let listQuery = this.k
      .selectFrom('notification_log')
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(filters.limit)
      .offset(filters.offset);
    if (filters.channelId) listQuery = listQuery.where('channel_id', '=', filters.channelId);
    if (filters.status) listQuery = listQuery.where('status', '=', filters.status);
    if (filters.source) listQuery = listQuery.where('source', '=', filters.source);
    const listCompiled = listQuery.compile();
    const rows = this.db
      .prepare(listCompiled.sql)
      .all(...listCompiled.parameters) as NotificationLogRow[];

    return { rows: rows.map(rowToEntry), total: totalRow.total };
  }

  public last24h(): { success: number; failed: number; skipped: number } {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const compiled = this.k
      .selectFrom('notification_log')
      .select((eb) => ['status', eb.fn.countAll<number>().as('count')])
      .where('created_at', '>=', since)
      .where('source', '=', 'live')
      .groupBy('status')
      .compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      status: 'success' | 'failed' | 'skipped';
      count: number;
    }>;

    const out = { success: 0, failed: 0, skipped: 0 };
    for (const row of rows) {
      if (Object.hasOwn(out, row.status)) out[row.status] = row.count;
    }
    return out;
  }

  public pruneOlderThan(cutoffMs: number): number {
    const compiled = this.k
      .deleteFrom('notification_log')
      .where('created_at', '<', cutoffMs)
      .compile();
    return this.db.prepare(compiled.sql).run(...compiled.parameters).changes;
  }

  public deleteById(id: string): number {
    const compiled = this.k.deleteFrom('notification_log').where('id', '=', id).compile();
    return this.db.prepare(compiled.sql).run(...compiled.parameters).changes;
  }

  public deleteByIds(ids: readonly string[]): number {
    if (ids.length === 0) return 0;
    const compiled = this.k
      .deleteFrom('notification_log')
      .where('id', 'in', ids as string[])
      .compile();
    return this.db.prepare(compiled.sql).run(...compiled.parameters).changes;
  }
}

function rowToEntry(row: NotificationLogRow): NotificationLogEntry {
  return {
    id: row.id,
    channelId: row.channel_id,
    channelType: row.channel_type as NotificationLogEntry['channelType'],
    ruleId: row.rule_id,
    ruleKind: row.rule_kind as NotificationLogEntry['ruleKind'],
    event: row.event,
    condition: row.condition,
    status: row.status as NotificationLogEntry['status'],
    skipReason: (row.skip_reason as NotificationLogEntry['skipReason']) ?? null,
    httpStatus: row.http_status,
    error: row.error,
    attempt: row.attempt,
    source: row.source as NotificationLogEntry['source'],
    createdAt: row.created_at,
  };
}

export const notificationLogDb = singletonOf(
  'notification_log',
  () => new NotificationLogDatabase()
);

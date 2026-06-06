import type { NotificationLogEntry } from '@playwright-reports/shared';
import type Database from 'better-sqlite3';
import { getDatabase } from './db.js';

const initiatedKey = Symbol.for('playwright.reports.db.notification_log');
const instance = globalThis as typeof globalThis & {
  [initiatedKey]?: NotificationLogDatabase;
};

interface DbRow {
  id: string;
  channel_id: string;
  channel_type: string;
  rule_id: string;
  rule_kind: string;
  event: string;
  condition: string;
  status: string;
  skip_reason: string | null;
  http_status: number | null;
  error: string | null;
  attempt: number;
  source: string;
  created_at: number;
}

export interface NotificationLogQueryFilters {
  channelId?: string;
  status?: 'success' | 'failed' | 'skipped';
  source?: 'live' | 'test';
  limit: number;
  offset: number;
}

export class NotificationLogDatabase {
  private readonly db = getDatabase();
  private readonly insertStmt: Database.Statement<
    [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string | null,
      number | null,
      string | null,
      number,
      string,
      number,
    ]
  >;
  private readonly countLast24hStmt: Database.Statement<[number]>;
  private readonly deleteOlderThanStmt: Database.Statement<[number]>;
  private readonly deleteByIdStmt: Database.Statement<[string]>;

  private constructor() {
    this.insertStmt = this.db.prepare(`
      INSERT INTO notification_log
        (id, channel_id, channel_type, rule_id, rule_kind, event, condition,
         status, skip_reason, http_status, error, attempt, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.countLast24hStmt = this.db.prepare(`
      SELECT status, COUNT(*) AS count
        FROM notification_log
        WHERE created_at >= ? AND source = 'live'
        GROUP BY status
    `);
    this.deleteOlderThanStmt = this.db.prepare(`
      DELETE FROM notification_log WHERE created_at < ?
    `);
    this.deleteByIdStmt = this.db.prepare(`DELETE FROM notification_log WHERE id = ?`);
  }

  public static getInstance(): NotificationLogDatabase {
    instance[initiatedKey] ??= new NotificationLogDatabase();
    return instance[initiatedKey];
  }

  public insert(entry: NotificationLogEntry): void {
    this.insertStmt.run(
      entry.id,
      entry.channelId,
      entry.channelType,
      entry.ruleId,
      entry.ruleKind,
      entry.event,
      entry.condition,
      entry.status,
      entry.skipReason ?? null,
      entry.httpStatus ?? null,
      entry.error ?? null,
      entry.attempt,
      entry.source,
      entry.createdAt
    );
  }

  public list(filters: NotificationLogQueryFilters): {
    rows: NotificationLogEntry[];
    total: number;
  } {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filters.channelId) {
      where.push('channel_id = ?');
      params.push(filters.channelId);
    }
    if (filters.status) {
      where.push('status = ?');
      params.push(filters.status);
    }
    if (filters.source) {
      where.push('source = ?');
      params.push(filters.source);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM notification_log ${whereSql}`)
      .get(...params) as { total: number };

    const rows = this.db
      .prepare(
        `SELECT * FROM notification_log ${whereSql}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, filters.limit, filters.offset) as DbRow[];

    return { rows: rows.map(rowToEntry), total: totalRow.total };
  }

  public last24h(): { success: number; failed: number; skipped: number } {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const out = { success: 0, failed: 0, skipped: 0 };
    const rows = this.countLast24hStmt.all(since) as Array<{
      status: 'success' | 'failed' | 'skipped';
      count: number;
    }>;
    for (const row of rows) {
      out[row.status] = row.count;
    }
    return out;
  }

  public pruneOlderThan(cutoffMs: number): number {
    const result = this.deleteOlderThanStmt.run(cutoffMs);
    return result.changes;
  }

  public deleteById(id: string): number {
    return this.deleteByIdStmt.run(id).changes;
  }

  public deleteByIds(ids: readonly string[]): number {
    if (ids.length === 0) return 0;
    let total = 0;
    const tx = this.db.transaction((batch: readonly string[]) => {
      for (const id of batch) {
        total += this.deleteByIdStmt.run(id).changes;
      }
    });
    tx(ids);
    return total;
  }
}

function rowToEntry(row: DbRow): NotificationLogEntry {
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

export const notificationLogDb = NotificationLogDatabase.getInstance();

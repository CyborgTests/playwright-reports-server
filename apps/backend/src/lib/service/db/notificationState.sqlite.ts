import type Database from 'better-sqlite3';
import { getDatabase } from './db.js';

const stateSymbol = Symbol.for('playwright.reports.db.notificationState');
const instance = globalThis as typeof globalThis & {
  [stateSymbol]?: NotificationStateDatabase;
};

export class NotificationStateDatabase {
  private readonly db = getDatabase();

  private readonly upsertStmt: Database.Statement<[string, string, string, number]>;
  private readonly getStmt: Database.Statement<[string, string, string]>;

  private constructor() {
    this.upsertStmt = this.db.prepare(`
      INSERT INTO notification_state (channel_id, rule_id, project, last_fired_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(channel_id, rule_id, project)
      DO UPDATE SET last_fired_at = excluded.last_fired_at
    `);

    this.getStmt = this.db.prepare(`
      SELECT last_fired_at FROM notification_state
      WHERE channel_id = ? AND rule_id = ? AND project = ?
    `);
  }

  public static getInstance(): NotificationStateDatabase {
    instance[stateSymbol] ??= new NotificationStateDatabase();
    return instance[stateSymbol];
  }

  public recordFire(channelId: string, ruleId: string, project: string, firedAtMs: number): void {
    this.upsertStmt.run(channelId, ruleId, project, firedAtMs);
  }

  public getLastFired(channelId: string, ruleId: string, project: string): number | undefined {
    const row = this.getStmt.get(channelId, ruleId, project) as
      | { last_fired_at: number }
      | undefined;
    return row?.last_fired_at;
  }
}

export const notificationStateDb = NotificationStateDatabase.getInstance();

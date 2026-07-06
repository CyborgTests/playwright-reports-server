import { getDatabase } from './db.js';
import { getKysely } from './kysely.js';
import { singletonOf } from './singleton.js';

export class NotificationStateDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();

  public recordFire(channelId: string, ruleId: string, project: string, firedAtMs: number): void {
    const compiled = this.k
      .insertInto('notification_state')
      .values({
        channel_id: channelId,
        rule_id: ruleId,
        project,
        last_fired_at: firedAtMs,
      })
      .onConflict((oc) =>
        oc
          .columns(['channel_id', 'rule_id', 'project'])
          .doUpdateSet((eb) => ({ last_fired_at: eb.ref('excluded.last_fired_at') }))
      )
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public getLastFired(channelId: string, ruleId: string, project: string): number | undefined {
    const compiled = this.k
      .selectFrom('notification_state')
      .select('last_fired_at')
      .where('channel_id', '=', channelId)
      .where('rule_id', '=', ruleId)
      .where('project', '=', project)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | { last_fired_at: number }
      | undefined;
    return row?.last_fired_at;
  }
}

export const notificationStateDb = singletonOf(
  'notificationState',
  () => new NotificationStateDatabase()
);

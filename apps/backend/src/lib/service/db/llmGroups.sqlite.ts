import { getDatabase } from './db.js';
import { getKysely, type LlmConcurrencyGroupsRow } from './kysely.js';
import { singletonOf } from './singleton.js';

export type LlmConcurrencyGroupRow = LlmConcurrencyGroupsRow;

export class LlmGroupsDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();

  public list(): LlmConcurrencyGroupRow[] {
    const compiled = this.k
      .selectFrom('llm_concurrency_groups')
      .selectAll()
      .orderBy('name', 'asc')
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as LlmConcurrencyGroupRow[];
  }

  public get(id: string): LlmConcurrencyGroupRow | undefined {
    const compiled = this.k
      .selectFrom('llm_concurrency_groups')
      .selectAll()
      .where('id', '=', id)
      .compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | LlmConcurrencyGroupRow
      | undefined;
  }

  public getByName(name: string): LlmConcurrencyGroupRow | undefined {
    const compiled = this.k
      .selectFrom('llm_concurrency_groups')
      .selectAll()
      .where('name', '=', name)
      .compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as
      | LlmConcurrencyGroupRow
      | undefined;
  }

  public insert(row: LlmConcurrencyGroupRow): void {
    const compiled = this.k.insertInto('llm_concurrency_groups').values(row).compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public update(id: string, patch: { name: string; concurrencyLimit: number }): void {
    const compiled = this.k
      .updateTable('llm_concurrency_groups')
      .set({
        name: patch.name,
        concurrencyLimit: patch.concurrencyLimit,
        updatedAt: new Date().toISOString(),
      })
      .where('id', '=', id)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public delete(id: string): void {
    const trx = this.db.transaction(() => {
      const clear = this.k
        .updateTable('llm_models')
        .set({ concurrencyGroupId: null, updatedAt: new Date().toISOString() })
        .where('concurrencyGroupId', '=', id)
        .compile();
      this.db.prepare(clear.sql).run(...clear.parameters);

      const del = this.k.deleteFrom('llm_concurrency_groups').where('id', '=', id).compile();
      this.db.prepare(del.sql).run(...del.parameters);
    });
    trx();
  }

  public memberCounts(): Map<string, number> {
    const compiled = this.k
      .selectFrom('llm_models')
      .select(['concurrencyGroupId'])
      .select((eb) => eb.fn.countAll().as('n'))
      .where('concurrencyGroupId', 'is not', null)
      .groupBy('concurrencyGroupId')
      .compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      concurrencyGroupId: string;
      n: number;
    }>;
    return new Map(rows.map((r) => [r.concurrencyGroupId, Number(r.n)]));
  }
}

export const llmGroupsDb = singletonOf('llmGroups', () => new LlmGroupsDatabase());

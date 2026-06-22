import { getDatabase } from './db.js';
import { getKysely, type LlmModelsRow } from './kysely.js';
import { singletonOf } from './singleton.js';

export type LlmModelRow = LlmModelsRow;

export type LlmModelWrite = Omit<LlmModelsRow, 'id' | 'createdAt' | 'updatedAt'>;

export class LlmModelsDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();

  public list(): LlmModelRow[] {
    const compiled = this.k
      .selectFrom('llm_models')
      .selectAll()
      .orderBy('sortOrder', 'asc')
      .orderBy('createdAt', 'asc')
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as LlmModelRow[];
  }

  public get(id: string): LlmModelRow | undefined {
    const compiled = this.k.selectFrom('llm_models').selectAll().where('id', '=', id).compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as LlmModelRow | undefined;
  }

  public getPrimary(): LlmModelRow | undefined {
    const compiled = this.k
      .selectFrom('llm_models')
      .selectAll()
      .where('isPrimary', '=', 1)
      .limit(1)
      .compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as LlmModelRow | undefined;
  }

  public count(): number {
    const compiled = this.k
      .selectFrom('llm_models')
      .select((eb) => eb.fn.countAll().as('n'))
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as { n: number };
    return Number(row?.n ?? 0);
  }

  public insert(row: LlmModelRow): void {
    const compiled = this.k.insertInto('llm_models').values(row).compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public update(id: string, patch: LlmModelWrite): void {
    const compiled = this.k
      .updateTable('llm_models')
      .set({
        label: patch.label,
        provider: patch.provider,
        baseUrl: patch.baseUrl,
        apiKeyCipher: patch.apiKeyCipher,
        model: patch.model,
        parallelRequests: patch.parallelRequests,
        maxTokens: patch.maxTokens,
        contextWindow: patch.contextWindow,
        multimodalMode: patch.multimodalMode,
        testAnalysisTemperature: patch.testAnalysisTemperature,
        reportSummaryTemperature: patch.reportSummaryTemperature,
        projectSummaryTemperature: patch.projectSummaryTemperature,
        inputCostPerMTok: patch.inputCostPerMTok,
        outputCostPerMTok: patch.outputCostPerMTok,
        sortOrder: patch.sortOrder,
        isPrimary: patch.isPrimary,
        enabled: patch.enabled,
        concurrencyGroupId: patch.concurrencyGroupId,
        lastTestedAt: patch.lastTestedAt,
        lastError: patch.lastError,
        updatedAt: new Date().toISOString(),
      })
      .where('id', '=', id)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public setEnabled(id: string, enabled: boolean): void {
    const compiled = this.k
      .updateTable('llm_models')
      .set({ enabled: enabled ? 1 : 0, updatedAt: new Date().toISOString() })
      .where('id', '=', id)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public setLastTested(id: string, at: string): void {
    const compiled = this.k
      .updateTable('llm_models')
      .set({ lastTestedAt: at, lastError: null, updatedAt: new Date().toISOString() })
      .where('id', '=', id)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public setLastError(id: string, error: string | null): void {
    const compiled = this.k
      .updateTable('llm_models')
      .set({ lastError: error, updatedAt: new Date().toISOString() })
      .where('id', '=', id)
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public setPrimary(id: string): void {
    const now = new Date().toISOString();
    const trx = this.db.transaction(() => {
      const clear = this.k
        .updateTable('llm_models')
        .set({ isPrimary: 0, updatedAt: now })
        .where('isPrimary', '=', 1)
        .compile();
      this.db.prepare(clear.sql).run(...clear.parameters);

      const set = this.k
        .updateTable('llm_models')
        .set({ isPrimary: 1, updatedAt: now })
        .where('id', '=', id)
        .compile();
      this.db.prepare(set.sql).run(...set.parameters);
    });
    trx();
  }

  public reorder(orderedIds: string[]): LlmModelRow[] {
    const now = new Date().toISOString();
    const trx = this.db.transaction(() => {
      for (let idx = 0; idx < orderedIds.length; idx++) {
        const compiled = this.k
          .updateTable('llm_models')
          .set({ sortOrder: idx, updatedAt: now })
          .where('id', '=', orderedIds[idx])
          .compile();
        this.db.prepare(compiled.sql).run(...compiled.parameters);
      }
    });
    trx();
    return this.list();
  }

  public delete(id: string): void {
    const compiled = this.k.deleteFrom('llm_models').where('id', '=', id).compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }
}

export const llmModelsDb = singletonOf('llmModels', () => new LlmModelsDatabase());

import { type ExpressionBuilder, type SelectQueryBuilder, sql } from 'kysely';
import { defaultProjectName } from '../../constants.js';
import type { ReadResultsInput, ReadResultsOutput, Result } from '../../storage/types.js';
import { getDatabase } from './db.js';
import { type Database, getKysely, type ResultsRow } from './kysely.js';
import { singletonOf } from './singleton.js';
import { chunk, parseJsonColumn } from './utils.js';

type ResultRow = ResultsRow;

const ID_CHUNK_SIZE = 300;

export class ResultDatabase {
  public initialized = false;
  private readonly k = getKysely();
  private readonly db = getDatabase();

  public getExpiredIds(cutoffISO: string, limit: number): string[] {
    const compiled = this.k
      .selectFrom('results')
      .select('resultID')
      .where('createdAt', '<', cutoffISO)
      .orderBy('createdAt', 'asc')
      .limit(limit)
      .compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      resultID: string;
    }>;
    return rows.map((row) => row.resultID);
  }

  public async init() {
    if (this.initialized) return;
    this.initialized = true;
    console.log(`[result db] initialized (${this.getCount()} results)`);
  }

  private insertResult(result: Result): void {
    const { resultID, project, title, createdAt, size, sizeBytes, ...metadata } = result;
    const compiled = this.k
      .insertInto('results')
      .values({
        resultID,
        project: project || '',
        title: title || null,
        createdAt,
        size: size || null,
        sizeBytes: sizeBytes || 0,
        metadata: JSON.stringify(metadata),
        updatedAt: new Date().toISOString(),
      })
      .onConflict((oc) =>
        oc.column('resultID').doUpdateSet((eb) => ({
          project: eb.ref('excluded.project'),
          title: eb.ref('excluded.title'),
          createdAt: eb.ref('excluded.createdAt'),
          size: eb.ref('excluded.size'),
          sizeBytes: eb.ref('excluded.sizeBytes'),
          metadata: eb.ref('excluded.metadata'),
          updatedAt: eb.ref('excluded.updatedAt'),
        }))
      )
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public onDeleted(resultIds: string[]) {
    if (resultIds.length === 0) return;
    const tx = this.db.transaction((ids: string[]) => {
      for (const batch of chunk(ids, ID_CHUNK_SIZE)) {
        const compiled = this.k.deleteFrom('results').where('resultID', 'in', batch).compile();
        this.db.prepare(compiled.sql).run(...compiled.parameters);
      }
    });
    tx(resultIds);
  }

  public onCreated(result: Result) {
    this.insertResult(result);
  }

  public getDistinctProjects(): string[] {
    const compiled = this.k
      .selectFrom('results')
      .select('project')
      .distinct()
      .where('project', '!=', '')
      .orderBy('project', 'asc')
      .compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      project: string;
    }>;
    return rows.map((r) => r.project);
  }

  public getDistinctTags(project?: string): string[] {
    let q = this.k.selectFrom('results').select('metadata');
    if (project) {
      q = q.where('project', '=', project);
    }
    const compiled = q.compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      metadata: string;
    }>;

    const allTags = new Set<string>();
    for (const row of rows) {
      const parsed = parseJsonColumn<Record<string, unknown>>(row.metadata, {});
      for (const [key, value] of Object.entries(parsed)) {
        if (value === undefined || value === null) continue;
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
          continue;
        allTags.add(`${key}: ${value}`);
      }
    }
    return Array.from(allTags).sort();
  }

  public getByID(resultID: string): Result | undefined {
    const compiled = this.k
      .selectFrom('results')
      .selectAll()
      .where('resultID', '=', resultID)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as ResultRow | undefined;
    return row ? this.rowToResult(row) : undefined;
  }

  public getByIDs(resultIDs: string[]): Result[] {
    if (resultIDs.length === 0) return [];
    const out: Result[] = [];
    for (const ids of chunk(resultIDs, ID_CHUNK_SIZE)) {
      const compiled = this.k
        .selectFrom('results')
        .selectAll()
        .where('resultID', 'in', ids)
        .compile();
      const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as ResultRow[];
      for (const row of rows) out.push(this.rowToResult(row));
    }
    return out;
  }

  public getCount(): number {
    const compiled = this.k
      .selectFrom('results')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as { count: number };
    return row.count;
  }

  public clear(): void {
    const compiled = this.k.deleteFrom('results').compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public query(input?: ReadResultsInput): ReadResultsOutput {
    const applyWhere = <O>(
      qb: SelectQueryBuilder<Database, 'results', O>
    ): SelectQueryBuilder<Database, 'results', O> => {
      let q = qb;
      if (input?.project && input.project !== defaultProjectName) {
        q = q.where('project', '=', input.project);
      }
      if (input?.testRun) {
        q = q.where('metadata', 'like', `%"testRun":"${input.testRun}"%`);
      }
      if (input?.tags?.length) {
        for (const tag of input.tags) {
          const [key, value] = tag.split(':').map((part) => part.trim());
          q = q.where('metadata', 'like', `%"${key}":"${value}"%`);
        }
      }
      const search = input?.search?.trim();
      if (search) {
        const pattern = `%${search.toLowerCase()}%`;
        q = q.where((eb) =>
          eb.or([
            eb(eb.fn('LOWER', ['title']), 'like', pattern),
            eb(eb.fn('LOWER', ['resultID']), 'like', pattern),
            eb(eb.fn('LOWER', ['project']), 'like', pattern),
            eb(eb.fn('LOWER', ['metadata']), 'like', pattern),
          ])
        );
      }
      if (input?.from) q = q.where('createdAt', '>=', input.from);
      if (input?.to) q = q.where('createdAt', '<', input.to);
      if (input?.usage === 'used') {
        q = q.where('resultID', 'in', (eb: ExpressionBuilder<Database, 'results'>) =>
          eb.selectFrom('report_results').select('resultId').distinct()
        );
      } else if (input?.usage === 'unused') {
        q = q.where('resultID', 'not in', (eb: ExpressionBuilder<Database, 'results'>) =>
          eb.selectFrom('report_results').select('resultId').distinct()
        );
      }
      return q;
    };

    const runCount = (): number => {
      const countCompiled = applyWhere(
        this.k.selectFrom('results').select((eb) => eb.fn.countAll<number>().as('count'))
      ).compile();
      return (
        this.db.prepare(countCompiled.sql).get(...countCompiled.parameters) as { count: number }
      ).count;
    };

    const hasScanFilter =
      !!input?.search?.trim() || (input?.tags?.length ?? 0) > 0 || !!input?.testRun;

    let listSelect = applyWhere(this.k.selectFrom('results').selectAll());
    if (hasScanFilter) {
      listSelect = listSelect.select(sql<number>`COUNT(*) OVER()`.as('__total'));
    }
    let listQuery = listSelect.orderBy('createdAt', 'desc');
    if (input?.pagination?.limit !== undefined) {
      listQuery = listQuery.limit(Math.max(0, Math.floor(input.pagination.limit)));
      listQuery = listQuery.offset(Math.max(0, Math.floor(input.pagination.offset ?? 0)));
    }
    const listCompiled = listQuery.compile();
    const rawRows = this.db.prepare(listCompiled.sql).all(...listCompiled.parameters) as Array<
      ResultRow & { __total?: number }
    >;

    let total: number;
    if (hasScanFilter) {
      if (rawRows.length > 0) {
        total = rawRows[0].__total ?? 0;
      } else {
        total = (input?.pagination?.offset ?? 0) > 0 ? runCount() : 0;
      }
    } else {
      total = runCount();
    }

    const rows = rawRows.map(({ __total, ...row }) => row as ResultRow);
    return { results: rows.map((row) => this.rowToResult(row)), total };
  }

  private rowToResult(row: ResultRow): Result {
    const metadata = parseJsonColumn<Record<string, unknown>>(row.metadata, {});
    return {
      resultID: row.resultID,
      project: row.project,
      title: row.title || undefined,
      createdAt: row.createdAt,
      size: row.size || undefined,
      sizeBytes: row.sizeBytes,
      ...metadata,
    } as unknown as Result;
  }
}

export const resultDb = singletonOf('results', () => new ResultDatabase());

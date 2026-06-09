import type Database from 'better-sqlite3';
import { defaultProjectName } from '../../constants.js';
import type { ReadResultsInput, ReadResultsOutput, Result } from '../../storage/types.js';
import { getDatabase } from './db.js';

import { singletonOf } from './singleton.js';
import { buildWhere, paginationClause, type WhereFragment } from './utils.js';
export class ResultDatabase {
  public initialized = false;
  private readonly db = getDatabase();

  private readonly insertStmt: Database.Statement<
    [string, string, string | null, string, string | null, number, string]
  >;
  private readonly deleteStmt: Database.Statement<[string]>;
  private readonly getByIDStmt: Database.Statement<[string]>;
  private readonly getAllStmt: Database.Statement<[]>;
  private readonly getByProjectStmt: Database.Statement<[string]>;
  private readonly searchStmt: Database.Statement<[string, string, string, string]>;
  private readonly getExpiredIdsStmt: Database.Statement<[string, number]>;

  constructor() {
    this.insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO results (resultID, project, title, createdAt, size, sizeBytes, metadata, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    this.deleteStmt = this.db.prepare('DELETE FROM results WHERE resultID = ?');

    this.getByIDStmt = this.db.prepare('SELECT * FROM results WHERE resultID = ?');

    this.getAllStmt = this.db.prepare('SELECT * FROM results ORDER BY createdAt DESC');

    this.getByProjectStmt = this.db.prepare(
      'SELECT * FROM results WHERE project = ? ORDER BY createdAt DESC'
    );

    this.searchStmt = this.db.prepare(`
      SELECT * FROM results
      WHERE title LIKE ? OR resultID LIKE ? OR project LIKE ? OR metadata LIKE ?
      ORDER BY createdAt DESC
    `);

    this.getExpiredIdsStmt = this.db.prepare(`
      SELECT resultID FROM results
      WHERE createdAt < ?
      ORDER BY createdAt ASC
      LIMIT ?
    `);
  }

  public getExpiredIds(cutoffISO: string, limit: number): string[] {
    const rows = this.getExpiredIdsStmt.all(cutoffISO, limit) as Array<{ resultID: string }>;
    return rows.map((row) => row.resultID);
  }

  public async init() {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    console.log(`[result db] initialized (${this.getCount()} results)`);
  }

  private insertResult(result: Result): void {
    const { resultID, project, title, createdAt, size, sizeBytes, ...metadata } = result;

    this.insertStmt.run(
      resultID,
      project || '',
      title || null,
      createdAt,
      size || null,
      sizeBytes || 0,
      JSON.stringify(metadata)
    );
  }

  public onDeleted(resultIds: string[]) {
    const deleteMany = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        this.deleteStmt.run(id);
      }
    });

    deleteMany(resultIds);
  }

  public onCreated(result: Result) {
    this.insertResult(result);
  }

  public getAll(): Result[] {
    const rows = this.getAllStmt.all() as Array<{
      resultID: string;
      project: string;
      title: string | null;
      createdAt: string;
      size: string | null;
      sizeBytes: number;
      metadata: string;
    }>;

    return rows.map(this.rowToResult);
  }

  public getByID(resultID: string): Result | undefined {
    const row = this.getByIDStmt.get(resultID) as
      | {
          resultID: string;
          project: string;
          title: string | null;
          createdAt: string;
          size: string | null;
          sizeBytes: number;
          metadata: string;
        }
      | undefined;

    return row ? this.rowToResult(row) : undefined;
  }

  public getByIDs(resultIDs: string[]): Result[] {
    if (resultIDs.length === 0) return [];
    const placeholders = resultIDs.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT * FROM results WHERE resultID IN (${placeholders})`)
      .all(...resultIDs) as Array<{
      resultID: string;
      project: string;
      title: string | null;
      createdAt: string;
      size: string | null;
      sizeBytes: number;
      metadata: string;
    }>;

    return rows.map((row) => this.rowToResult(row));
  }

  public getByProject(project: string): Result[] {
    const rows = this.getByProjectStmt.all(project) as Array<{
      resultID: string;
      project: string;
      title: string | null;
      createdAt: string;
      size: string | null;
      sizeBytes: number;
      metadata: string;
    }>;

    return rows.map(this.rowToResult);
  }

  public search(query: string): Result[] {
    const searchPattern = `%${query}%`;
    const rows = this.searchStmt.all(
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern
    ) as Array<{
      resultID: string;
      project: string;
      title: string | null;
      createdAt: string;
      size: string | null;
      sizeBytes: number;
      metadata: string;
    }>;

    return rows.map(this.rowToResult);
  }

  public getCount(): number {
    const result = this.db.prepare('SELECT COUNT(*) as count FROM results').get() as {
      count: number;
    };

    return result.count;
  }

  public clear(): void {
    this.db.prepare('DELETE FROM results').run();
  }

  public query(input?: ReadResultsInput): ReadResultsOutput {
    const tagFragments =
      input?.tags?.map((tag): WhereFragment => {
        const [key, value] = tag.split(':').map((part) => part.trim());
        return { sql: 'metadata LIKE ?', params: [`%"${key}":"${value}"%`] };
      }) ?? [];

    const search = input?.search?.trim();
    const searchTerm = search ? `%${search.toLowerCase()}%` : null;

    const { sql: whereSql, params: whereParams } = buildWhere([
      input?.project && input.project !== defaultProjectName
        ? { sql: 'project = ?', params: [input.project] }
        : null,
      input?.testRun
        ? { sql: 'metadata LIKE ?', params: [`%"testRun":"${input.testRun}"%`] }
        : null,
      ...tagFragments,
      searchTerm
        ? {
            sql: '(LOWER(title) LIKE ? OR LOWER(resultID) LIKE ? OR LOWER(project) LIKE ? OR LOWER(metadata) LIKE ?)',
            params: [searchTerm, searchTerm, searchTerm, searchTerm],
          }
        : null,
      input?.from ? { sql: 'createdAt >= ?', params: [input.from] } : null,
      input?.to ? { sql: 'createdAt < ?', params: [input.to] } : null,
      input?.usage === 'used'
        ? { sql: 'resultID IN (SELECT DISTINCT resultId FROM report_results)', params: [] }
        : input?.usage === 'unused'
          ? { sql: 'resultID NOT IN (SELECT DISTINCT resultId FROM report_results)', params: [] }
          : null,
    ]);

    const baseQuery = `SELECT * FROM results ${whereSql} ORDER BY createdAt DESC`.trim();
    const countQuery = `SELECT COUNT(*) as count FROM results ${whereSql}`.trim();

    const countResult = this.db.prepare(countQuery).get(...whereParams) as { count: number };
    const total = countResult.count;

    const { sql: pageSql, params: pageParams } = paginationClause(input?.pagination);
    const finalQuery = pageSql ? `${baseQuery} ${pageSql}` : baseQuery;
    const finalParams = [...whereParams, ...pageParams];

    const rows = this.db.prepare(finalQuery).all(...finalParams) as Array<{
      resultID: string;
      project: string;
      title: string | null;
      createdAt: string;
      size: string | null;
      sizeBytes: number;
      metadata: string;
    }>;

    return {
      results: rows.map((row) => this.rowToResult(row)),
      total,
    };
  }

  private rowToResult(row: {
    resultID: string;
    project: string;
    title: string | null;
    createdAt: string;
    size: string | null;
    sizeBytes: number;
    metadata: string;
  }): Result {
    const metadata = JSON.parse(row.metadata || '{}');

    return {
      resultID: row.resultID,
      project: row.project,
      title: row.title || undefined,
      createdAt: row.createdAt,
      size: row.size || undefined,
      sizeBytes: row.sizeBytes,
      ...metadata,
    };
  }
}

export const resultDb = singletonOf('results', () => new ResultDatabase());

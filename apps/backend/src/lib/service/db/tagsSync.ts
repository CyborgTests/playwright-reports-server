import { RESERVED_REPORT_FIELDS } from '@playwright-reports/shared';
import type Database from 'better-sqlite3';

export type TagPair = [key: string, value: string];

function scalarToString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function extractReportTags(metadata: Record<string, unknown>): TagPair[] {
  const out: TagPair[] = [];
  for (const [key, raw] of Object.entries(metadata)) {
    if (RESERVED_REPORT_FIELDS.has(key)) continue;
    const value = scalarToString(raw);
    if (value !== null) out.push([key, value]);
  }
  return out;
}

export function extractResultTags(metadata: Record<string, unknown>): TagPair[] {
  const out: TagPair[] = [];
  for (const [key, raw] of Object.entries(metadata)) {
    const value = scalarToString(raw);
    if (value !== null) out.push([key, value]);
  }
  return out;
}

function replaceTags(
  db: Database.Database,
  table: 'report_tags' | 'result_tags',
  idColumn: 'reportId' | 'resultId',
  id: string,
  tags: TagPair[]
): void {
  db.prepare(`DELETE FROM ${table} WHERE ${idColumn} = ?`).run(id);
  if (tags.length === 0) return;
  const insert = db.prepare(
    `INSERT OR REPLACE INTO ${table} (${idColumn}, key, value) VALUES (?, ?, ?)`
  );
  for (const [key, value] of tags) insert.run(id, key, value);
}

export function replaceReportTags(
  db: Database.Database,
  reportId: string,
  metadata: Record<string, unknown>
): void {
  replaceTags(db, 'report_tags', 'reportId', reportId, extractReportTags(metadata));
}

export function replaceResultTags(
  db: Database.Database,
  resultId: string,
  metadata: Record<string, unknown>
): void {
  replaceTags(db, 'result_tags', 'resultId', resultId, extractResultTags(metadata));
}

export function distinctTags(
  db: Database.Database,
  spec: { entity: 'report'; project?: string } | { entity: 'result'; project?: string }
): string[] {
  const table = spec.entity === 'report' ? 'report_tags' : 'result_tags';
  const parent = spec.entity === 'report' ? 'reports' : 'results';
  const idColumn = spec.entity === 'report' ? 'reportId' : 'resultId';
  const parentId = spec.entity === 'report' ? 'reportID' : 'resultID';

  const rows = spec.project
    ? (db
        .prepare(
          `SELECT DISTINCT t.key AS key, t.value AS value
           FROM ${table} t JOIN ${parent} p ON p.${parentId} = t.${idColumn}
           WHERE p.project = ?`
        )
        .all(spec.project) as Array<{ key: string; value: string }>)
    : (db.prepare(`SELECT DISTINCT key, value FROM ${table}`).all() as Array<{
        key: string;
        value: string;
      }>);

  return rows.map((r) => `${r.key}: ${r.value}`).sort();
}

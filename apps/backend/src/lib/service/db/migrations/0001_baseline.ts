import type { Kysely } from 'kysely';
import { getDatabase } from '../db.js';
import { qualityDashboardsDb } from '../qualityDashboards.sqlite.js';
import { SCHEMA_SQL } from './baseline.schema.js';

// Frozen baseline schema.
// Do NOT edit this list to evolve the schema.
// Add a new numbered migration with the forward change instead.
export async function up(_db: Kysely<unknown>): Promise<void> {
  const db = getDatabase();
  db.exec(SCHEMA_SQL);
  qualityDashboardsDb.seedDefaultDashboard();
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // The baseline has no `down`: dropping every table would destroy all data.
  // If a full teardown is ever needed, do it explicitly.
}

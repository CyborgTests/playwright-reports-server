import type { Kysely } from 'kysely';
import { getDatabase } from '../db.js';

export async function up(_db: Kysely<unknown>): Promise<void> {
  getDatabase().exec('ALTER TABLE reports DROP COLUMN files');
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  getDatabase().exec('ALTER TABLE reports ADD COLUMN files TEXT');
}

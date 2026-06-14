import type { Kysely } from 'kysely';
import { qualityDashboardsDb } from '../qualityDashboards.sqlite.js';

// Seeds the default "Overview" quality dashboard on first migrate.
export async function up(_db: Kysely<unknown>): Promise<void> {
  qualityDashboardsDb.seedDefaultDashboard();
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // Seed data; intentionally not removed on down.
}

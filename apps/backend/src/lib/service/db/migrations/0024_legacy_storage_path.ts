import type { Kysely } from 'kysely';

// Legacy reports imported from the original file-based server live at their original
// `reports/{project}/{id}/` location (this fork serves flat `reports/{id}/`). `storagePath`
// records that relative prefix so the serve route can resolve the bytes in place without
// copying gigabytes on S3/Azure. Null = native flat layout (path is the reportID itself).
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('reports').addColumn('storagePath', 'text').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('reports').dropColumn('storagePath').execute();
}

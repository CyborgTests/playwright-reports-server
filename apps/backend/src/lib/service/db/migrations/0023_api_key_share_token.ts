import type { Kysely } from 'kysely';

// Share-type API keys back public report links, so their plaintext must be retrievable to
// rebuild the link when someone selects an existing share token. It is a view-only bearer
// capability meant to live in URLs (not a secret password); it stays null for every other
// key type, which remain hash-only.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('api_keys').addColumn('shareToken', 'text').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('api_keys').dropColumn('shareToken').execute();
}

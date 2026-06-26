import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`PRAGMA foreign_keys = OFF`.execute(db);

  await sql`DROP TABLE IF EXISTS users_new`.execute(db);
  await sql`
    CREATE TABLE users_new (
      id           TEXT PRIMARY KEY,
      username     TEXT NOT NULL UNIQUE COLLATE NOCASE,
      passwordHash TEXT,
      email        TEXT COLLATE NOCASE,
      role         TEXT NOT NULL CHECK (role IN ('admin', 'reader', 'readonly')),
      disabled     INTEGER NOT NULL DEFAULT 0,
      createdAt    TEXT NOT NULL,
      updatedAt    TEXT NOT NULL,
      createdBy    TEXT,
      inviteId     TEXT
    )
  `.execute(db);
  await sql`
    INSERT INTO users_new (id, username, passwordHash, email, role, disabled, createdAt, updatedAt, createdBy, inviteId)
      SELECT id, username, passwordHash, NULL, role, disabled, createdAt, updatedAt, createdBy, inviteId
      FROM users
  `.execute(db);
  await sql`DROP TABLE users`.execute(db);
  await sql`ALTER TABLE users_new RENAME TO users`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_users_invite ON users(inviteId)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL`.execute(
    db
  );

  await sql`PRAGMA foreign_keys = ON`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS user_identities (
      id            TEXT PRIMARY KEY,
      userId        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider      TEXT NOT NULL CHECK (provider IN ('github', 'google', 'oidc')),
      externalId    TEXT NOT NULL,
      email         TEXT,
      emailVerified INTEGER NOT NULL DEFAULT 0,
      displayName   TEXT,
      createdAt     TEXT NOT NULL,
      lastLoginAt   TEXT,
      UNIQUE(provider, externalId)
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities(userId)`.execute(
    db
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS user_identities`.execute(db);

  await sql`PRAGMA foreign_keys = OFF`.execute(db);

  await sql`DROP TABLE IF EXISTS users_old`.execute(db);
  await sql`
    CREATE TABLE users_old (
      id           TEXT PRIMARY KEY,
      username     TEXT NOT NULL UNIQUE COLLATE NOCASE,
      passwordHash TEXT NOT NULL,
      role         TEXT NOT NULL CHECK (role IN ('admin', 'reader', 'readonly')),
      disabled     INTEGER NOT NULL DEFAULT 0,
      createdAt    TEXT NOT NULL,
      updatedAt    TEXT NOT NULL,
      createdBy    TEXT,
      inviteId     TEXT
    )
  `.execute(db);
  await sql`
    INSERT INTO users_old (id, username, passwordHash, role, disabled, createdAt, updatedAt, createdBy, inviteId)
      SELECT id, username, COALESCE(passwordHash, ''), role, disabled, createdAt, updatedAt, createdBy, inviteId
      FROM users
  `.execute(db);
  await sql`DROP TABLE users`.execute(db);
  await sql`ALTER TABLE users_old RENAME TO users`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_users_invite ON users(inviteId)`.execute(db);

  await sql`PRAGMA foreign_keys = ON`.execute(db);
}

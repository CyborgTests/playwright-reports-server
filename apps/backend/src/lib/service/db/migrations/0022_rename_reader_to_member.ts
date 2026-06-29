import { type Kysely, sql } from 'kysely';

// Rename the `reader` role to `member`.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`PRAGMA foreign_keys = OFF`.execute(db);

  await sql`DROP TABLE IF EXISTS users_new`.execute(db);
  await sql`
    CREATE TABLE users_new (
      id           TEXT PRIMARY KEY,
      username     TEXT NOT NULL UNIQUE COLLATE NOCASE,
      passwordHash TEXT,
      email        TEXT COLLATE NOCASE,
      role         TEXT NOT NULL CHECK (role IN ('admin', 'member', 'readonly')),
      disabled     INTEGER NOT NULL DEFAULT 0,
      createdAt    TEXT NOT NULL,
      updatedAt    TEXT NOT NULL,
      createdBy    TEXT,
      inviteId     TEXT
    )
  `.execute(db);
  await sql`
    INSERT INTO users_new (id, username, passwordHash, email, role, disabled, createdAt, updatedAt, createdBy, inviteId)
      SELECT id, username, passwordHash, email,
             CASE WHEN role = 'reader' THEN 'member' ELSE role END,
             disabled, createdAt, updatedAt, createdBy, inviteId
      FROM users
  `.execute(db);
  await sql`DROP TABLE users`.execute(db);
  await sql`ALTER TABLE users_new RENAME TO users`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_users_invite ON users(inviteId)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL`.execute(
    db
  );

  await sql`DROP TABLE IF EXISTS invites_new`.execute(db);
  await sql`
    CREATE TABLE invites_new (
      id        TEXT PRIMARY KEY,
      codeHash  TEXT NOT NULL UNIQUE,
      role      TEXT NOT NULL CHECK (role IN ('member', 'readonly')),
      createdBy TEXT,
      createdAt TEXT NOT NULL,
      expiresAt TEXT,
      maxUses   INTEGER,
      useCount  INTEGER NOT NULL DEFAULT 0,
      revokedAt TEXT
    )
  `.execute(db);
  await sql`
    INSERT INTO invites_new (id, codeHash, role, createdBy, createdAt, expiresAt, maxUses, useCount, revokedAt)
      SELECT id, codeHash,
             CASE WHEN role = 'reader' THEN 'member' ELSE role END,
             createdBy, createdAt, expiresAt, maxUses, useCount, revokedAt
      FROM invites
  `.execute(db);
  await sql`DROP TABLE invites`.execute(db);
  await sql`ALTER TABLE invites_new RENAME TO invites`.execute(db);

  await sql`UPDATE sessions SET role = 'member' WHERE role = 'reader'`.execute(db);

  await sql`PRAGMA foreign_keys = ON`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`PRAGMA foreign_keys = OFF`.execute(db);

  await sql`DROP TABLE IF EXISTS users_old`.execute(db);
  await sql`
    CREATE TABLE users_old (
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
    INSERT INTO users_old (id, username, passwordHash, email, role, disabled, createdAt, updatedAt, createdBy, inviteId)
      SELECT id, username, passwordHash, email,
             CASE WHEN role = 'member' THEN 'reader' ELSE role END,
             disabled, createdAt, updatedAt, createdBy, inviteId
      FROM users
  `.execute(db);
  await sql`DROP TABLE users`.execute(db);
  await sql`ALTER TABLE users_old RENAME TO users`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_users_invite ON users(inviteId)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL`.execute(
    db
  );

  await sql`DROP TABLE IF EXISTS invites_old`.execute(db);
  await sql`
    CREATE TABLE invites_old (
      id        TEXT PRIMARY KEY,
      codeHash  TEXT NOT NULL UNIQUE,
      role      TEXT NOT NULL CHECK (role IN ('reader', 'readonly')),
      createdBy TEXT,
      createdAt TEXT NOT NULL,
      expiresAt TEXT,
      maxUses   INTEGER,
      useCount  INTEGER NOT NULL DEFAULT 0,
      revokedAt TEXT
    )
  `.execute(db);
  await sql`
    INSERT INTO invites_old (id, codeHash, role, createdBy, createdAt, expiresAt, maxUses, useCount, revokedAt)
      SELECT id, codeHash,
             CASE WHEN role = 'member' THEN 'reader' ELSE role END,
             createdBy, createdAt, expiresAt, maxUses, useCount, revokedAt
      FROM invites
  `.execute(db);
  await sql`DROP TABLE invites`.execute(db);
  await sql`ALTER TABLE invites_old RENAME TO invites`.execute(db);

  await sql`UPDATE sessions SET role = 'reader' WHERE role = 'member'`.execute(db);

  await sql`PRAGMA foreign_keys = ON`.execute(db);
}

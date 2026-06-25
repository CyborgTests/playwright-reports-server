import { type Kysely, sql } from 'kysely';

// Auth & user management: accounts, stateful sessions, scoped API keys, invites,
// password-reset tokens, and an auth audit log. See AUTH_PRD.md.
// Personal API keys / sessions / reset tokens cascade-delete with their owning user
// (foreign_keys pragma is ON); service keys (null ownerUserId) survive user deletion.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
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
  await sql`CREATE INDEX IF NOT EXISTS idx_users_invite ON users(inviteId)`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      tokenHash     TEXT NOT NULL UNIQUE,
      userId        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role          TEXT NOT NULL,
      createdAt     TEXT NOT NULL,
      expiresAt     TEXT NOT NULL,
      idleExpiresAt TEXT NOT NULL,
      lastSeenAt    TEXT NOT NULL,
      userAgent     TEXT,
      ip            TEXT
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expiresAt)`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS api_keys (
      id          TEXT PRIMARY KEY,
      keyHash     TEXT NOT NULL UNIQUE,
      label       TEXT NOT NULL,
      scopes      TEXT NOT NULL,
      capability  TEXT NOT NULL CHECK (capability IN ('read', 'content')),
      ownerUserId TEXT REFERENCES users(id) ON DELETE CASCADE,
      createdBy   TEXT,
      createdAt   TEXT NOT NULL,
      expiresAt   TEXT,
      lastUsedAt  TEXT,
      revokedAt   TEXT
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_api_keys_owner ON api_keys(ownerUserId)`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS invites (
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
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id        TEXT PRIMARY KEY,
      tokenHash TEXT NOT NULL UNIQUE,
      userId    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      createdBy TEXT,
      createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      usedAt    TEXT
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON password_reset_tokens(userId)`.execute(
    db
  );

  await sql`
    CREATE TABLE IF NOT EXISTS auth_audit (
      id     TEXT PRIMARY KEY,
      ts     TEXT NOT NULL,
      actor  TEXT,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT
    )
  `.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS idx_auth_audit_ts ON auth_audit(ts)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS auth_audit`.execute(db);
  await sql`DROP TABLE IF EXISTS password_reset_tokens`.execute(db);
  await sql`DROP TABLE IF EXISTS invites`.execute(db);
  await sql`DROP TABLE IF EXISTS api_keys`.execute(db);
  await sql`DROP TABLE IF EXISTS sessions`.execute(db);
  await sql`DROP TABLE IF EXISTS users`.execute(db);
}

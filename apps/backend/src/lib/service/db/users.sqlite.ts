import { nowISO, runUpdate, tx } from './authShared.js';
import { getDatabase } from './db.js';
import { getKysely } from './kysely.js';
import { singletonOf } from './singleton.js';

// Fixed-id break-glass admin row: excluded from listings and the last-admin invariant.
export const ROOT_USER_ID = 'root';

export type UserRole = 'admin' | 'reader' | 'readonly';

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string | null;
  email: string | null;
  role: UserRole;
  disabled: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  inviteId: string | null;
}

export interface NewUser {
  id: string;
  username: string;
  passwordHash: string | null;
  email?: string | null;
  role: UserRole;
  disabled?: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  inviteId?: string | null;
}

export class UsersDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();

  public createUser(row: NewUser): void {
    const compiled = this.k
      .insertInto('users')
      .values({
        ...row,
        disabled: row.disabled ?? 0,
        email: row.email ?? null,
        inviteId: row.inviteId ?? null,
      })
      .compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public getUserById(id: string): UserRecord | undefined {
    const compiled = this.k.selectFrom('users').selectAll().where('id', '=', id).compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as UserRecord | undefined;
  }

  // username column is COLLATE NOCASE, so this match is case-insensitive.
  public getUserByUsername(username: string): UserRecord | undefined {
    const compiled = this.k
      .selectFrom('users')
      .selectAll()
      .where('username', '=', username)
      .compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as UserRecord | undefined;
  }

  public getUserByEmail(email: string): UserRecord | undefined {
    if (!email) return undefined;
    const compiled = this.k
      .selectFrom('users')
      .selectAll()
      .where('email', '=', email)
      .where('id', '!=', ROOT_USER_ID)
      .compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as UserRecord | undefined;
  }

  public listUsers(): UserRecord[] {
    const compiled = this.k
      .selectFrom('users')
      .selectAll()
      .where('id', '!=', ROOT_USER_ID)
      .orderBy('createdAt', 'asc')
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as UserRecord[];
  }

  public countUsers(): number {
    const compiled = this.k
      .selectFrom('users')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('id', '!=', ROOT_USER_ID)
      .compile();
    return Number((this.db.prepare(compiled.sql).get(...compiled.parameters) as { n: number }).n);
  }

  public listUsersPaged(limit: number, offset: number): UserRecord[] {
    const compiled = this.k
      .selectFrom('users')
      .selectAll()
      .where('id', '!=', ROOT_USER_ID)
      .orderBy('createdAt', 'asc')
      .limit(limit)
      .offset(offset)
      .compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as UserRecord[];
  }

  public setUserDisabled(id: string, disabled: boolean): void {
    runUpdate('users', { disabled: disabled ? 1 : 0, updatedAt: nowISO() }, id);
  }

  public setUserRole(id: string, role: UserRole): void {
    runUpdate('users', { role, updatedAt: nowISO() }, id);
  }

  public setUserPassword(id: string, passwordHash: string): void {
    runUpdate('users', { passwordHash, updatedAt: nowISO() }, id);
  }

  public deleteUser(id: string): void {
    const compiled = this.k.deleteFrom('users').where('id', '=', id).compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  // Atomic first-admin creation for setup; false if an admin already exists (race-safe).
  public createUserIfNoAdmin(row: NewUser): boolean {
    return tx(() => {
      if (this.hasAnyAdmin()) return false;
      this.createUser(row);
      return true;
    });
  }

  // Keyed on the fixed id, so renaming ROOT_USERNAME renames the row (no orphans).
  public upsertRootUser(username: string, passwordHash: string): void {
    const now = nowISO();
    tx(() => {
      if (this.getUserById(ROOT_USER_ID)) {
        runUpdate(
          'users',
          { username, passwordHash, role: 'admin', disabled: 0, updatedAt: now },
          ROOT_USER_ID
        );
      } else {
        this.createUser({
          id: ROOT_USER_ID,
          username,
          passwordHash,
          role: 'admin',
          createdAt: now,
          updatedAt: now,
          createdBy: 'system',
        });
      }
    });
  }

  public deleteRootUser(): void {
    this.deleteUser(ROOT_USER_ID);
  }

  // Excludes the reserved root row — it is recovery-only, not a real admin.
  public countEnabledAdmins(): number {
    const compiled = this.k
      .selectFrom('users')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('role', '=', 'admin')
      .where('disabled', '=', 0)
      .where('id', '!=', ROOT_USER_ID)
      .compile();
    const row = this.db.prepare(compiled.sql).get(...compiled.parameters) as { n: number };
    return Number(row.n);
  }

  public hasAnyAdmin(): boolean {
    const compiled = this.k
      .selectFrom('users')
      .select('id')
      .where('role', '=', 'admin')
      .where('id', '!=', ROOT_USER_ID)
      .limit(1)
      .compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) !== undefined;
  }
}

export const usersDb = singletonOf('users', () => new UsersDatabase());

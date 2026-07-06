import { runUpdate, tx } from './authShared.js';
import { getDatabase } from './db.js';
import { getKysely } from './kysely.js';
import { singletonOf } from './singleton.js';
import { type NewUser, usersDb } from './users.sqlite.js';

export interface InviteRecord {
  id: string;
  codeHash: string;
  role: 'member' | 'readonly';
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  revokedAt: string | null;
}

export class InvitesDatabase {
  private readonly k = getKysely();
  private readonly db = getDatabase();

  public insertInvite(row: InviteRecord): void {
    const compiled = this.k.insertInto('invites').values(row).compile();
    this.db.prepare(compiled.sql).run(...compiled.parameters);
  }

  public getInviteByHash(codeHash: string): InviteRecord | undefined {
    const compiled = this.k
      .selectFrom('invites')
      .selectAll()
      .where('codeHash', '=', codeHash)
      .compile();
    return this.db.prepare(compiled.sql).get(...compiled.parameters) as InviteRecord | undefined;
  }

  // Validate+spend the invite and create the user in one txn (no wasted use on clash).
  public consumeInviteAndCreateUser(
    codeHash: string,
    nowIso: string,
    user: NewUser
  ): 'ok' | 'invalid_invite' | 'username_taken' {
    return tx<'ok' | 'invalid_invite' | 'username_taken'>(() => {
      const inv = this.getInviteByHash(codeHash);
      if (
        !inv ||
        inv.revokedAt ||
        (inv.expiresAt && inv.expiresAt < nowIso) ||
        (inv.maxUses != null && inv.useCount >= inv.maxUses)
      ) {
        return 'invalid_invite';
      }
      if (usersDb.getUserByUsername(user.username)) return 'username_taken';
      runUpdate('invites', { useCount: inv.useCount + 1 }, inv.id);
      // The invite's role is the source of truth for the created account's role.
      usersDb.createUser({ ...user, role: inv.role, inviteId: inv.id });
      return 'ok';
    });
  }

  public usernamesByInvite(): Map<string, string[]> {
    const compiled = this.k
      .selectFrom('users')
      .select(['inviteId', 'username'])
      .where('inviteId', 'is not', null)
      .orderBy('createdAt', 'asc')
      .compile();
    const rows = this.db.prepare(compiled.sql).all(...compiled.parameters) as Array<{
      inviteId: string;
      username: string;
    }>;
    const map = new Map<string, string[]>();
    for (const r of rows) {
      const list = map.get(r.inviteId) ?? [];
      list.push(r.username);
      map.set(r.inviteId, list);
    }
    return map;
  }

  public revokeInvite(id: string, revokedAt: string): void {
    runUpdate('invites', { revokedAt }, id);
  }

  public listInvitesPaged(limit: number, offset: number, includeRevoked = false): InviteRecord[] {
    let query = this.k.selectFrom('invites').selectAll();
    if (!includeRevoked) query = query.where('revokedAt', 'is', null);
    const compiled = query.orderBy('createdAt', 'desc').limit(limit).offset(offset).compile();
    return this.db.prepare(compiled.sql).all(...compiled.parameters) as InviteRecord[];
  }

  public countInvites(includeRevoked = false): number {
    let query = this.k.selectFrom('invites').select((eb) => eb.fn.countAll().as('n'));
    if (!includeRevoked) query = query.where('revokedAt', 'is', null);
    const compiled = query.compile();
    return Number((this.db.prepare(compiled.sql).get(...compiled.parameters) as { n: number }).n);
  }
}

export const invitesDb = singletonOf('invites', () => new InvitesDatabase());

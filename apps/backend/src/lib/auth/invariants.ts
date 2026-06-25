import { usersDb } from '../service/db/index.js';

export class LastAdminError extends Error {
  constructor(message = 'Operation would remove the last enabled admin') {
    super(message);
    this.name = 'LastAdminError';
  }
}

// Guards disable / demote / delete of a user: throws if the target is the only
// remaining enabled admin (the reserved root row is excluded from the count).
// Call inside the same transaction as the mutation it protects.
export function assertNotLastAdmin(targetUserId: string): void {
  const target = usersDb.getUserById(targetUserId);
  if (!target || target.role !== 'admin' || target.disabled) return; // not an active admin
  if (usersDb.countEnabledAdmins() <= 1) throw new LastAdminError();
}

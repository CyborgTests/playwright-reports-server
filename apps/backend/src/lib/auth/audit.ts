import { randomUUID } from 'node:crypto';
import { authAuditDb } from '../service/db/index.js';

export type AuthAction =
  | 'login'
  | 'login_failed'
  | 'root_login'
  | 'logout'
  | 'logout_all'
  | 'setup'
  | 'register'
  | 'user_create'
  | 'user_disable'
  | 'user_enable'
  | 'user_role_change'
  | 'user_delete'
  | 'key_create'
  | 'key_revoke'
  | 'invite_create'
  | 'invite_revoke'
  | 'password_reset_issue'
  | 'password_reset_complete'
  | 'password_change'
  | 'oauth_login'
  | 'oauth_register'
  | 'oauth_link'
  | 'oauth_unlink'
  | 'oauth_login_failed';

export interface AuditOptions {
  actor?: string | null; // user id, 'root', or 'system'
  target?: string | null;
  detail?: string | null;
}

export function audit(action: AuthAction, opts: AuditOptions = {}): void {
  authAuditDb.insertAudit({
    id: randomUUID(),
    ts: new Date().toISOString(),
    actor: opts.actor ?? null,
    action,
    target: opts.target ?? null,
    detail: opts.detail ?? null,
  });
}

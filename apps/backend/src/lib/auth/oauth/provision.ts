import { randomUUID } from 'node:crypto';
import type { OAuthProviderId, OAuthProvisioningMode } from '@playwright-reports/shared';
import { invitesDb, siteConfigDb, tx, userIdentitiesDb, usersDb } from '../../service/db/index.js';
import { hashToken } from '../tokens.js';
import type { OAuthProfile } from './types.js';

export type ProvisionResult =
  | { ok: true; userId: string; isNew: boolean; linked: boolean }
  | { ok: false; reason: string };

function uniqueUsername(base: string): string {
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 32) || 'user';
  if (!usersDb.getUserByUsername(clean)) return clean;
  return `${clean}-${randomUUID().slice(0, 8)}`;
}

function emailDomainAllowed(email: string | null | undefined, allowed: string[]): boolean {
  if (!email) return false;
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email
    .slice(at + 1)
    .toLowerCase()
    .trim();
  return allowed.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function findOrProvision(
  providerId: OAuthProviderId,
  profile: OAuthProfile,
  mode: OAuthProvisioningMode,
  inviteCode: string | undefined
): ProvisionResult {
  const existing = userIdentitiesDb.findByProviderExternalId(providerId, profile.externalId);
  if (existing) {
    const user = usersDb.getUserById(existing.userId);
    if (!user || user.disabled) return { ok: false, reason: 'account_disabled' };
    userIdentitiesDb.touchLastLogin(existing.id);
    return { ok: true, userId: user.id, isNew: false, linked: false };
  }

  // Gate BEFORE any provisioning or auto-linking of a not-yet-linked identity.
  // In open mode the domain allowlist applies; in invite_only a valid invite is
  // required. Without this, the verified-email auto-link below would absorb an
  // existing account with no invite and no domain check (auth bypass).
  if (mode === 'open') {
    const allowed = siteConfigDb.get().oauth?.[providerId]?.allowedEmailDomains ?? [];
    if (
      allowed.length > 0 &&
      !(profile.emailVerified && emailDomainAllowed(profile.email, allowed))
    ) {
      return { ok: false, reason: 'email_domain_not_allowed' };
    }
  } else if (mode === 'invite_only' && !inviteCode) {
    return { ok: false, reason: 'no_invite' };
  }

  // Auto-link a verified email to an existing local account (now that the mode
  // gate above has passed).
  if (profile.emailVerified && profile.email) {
    const match = usersDb.getUserByEmail(profile.email);
    if (match) {
      if (match.disabled) return { ok: false, reason: 'account_disabled' };
      userIdentitiesDb.linkIdentity({
        id: randomUUID(),
        userId: match.id,
        provider: providerId,
        externalId: profile.externalId,
        email: profile.email,
        emailVerified: true,
        displayName: profile.displayName,
      });
      return { ok: true, userId: match.id, isNew: false, linked: true };
    }
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const username = uniqueUsername(profile.username || profile.email?.split('@')[0] || providerId);
  const email = profile.emailVerified ? profile.email : null;
  const linkRow = {
    id: randomUUID(),
    userId: id,
    provider: providerId,
    externalId: profile.externalId,
    email: profile.email,
    emailVerified: profile.emailVerified,
    displayName: profile.displayName,
  };

  if (mode === 'invite_only') {
    if (!inviteCode) return { ok: false, reason: 'no_invite' };
    const outcome = invitesDb.consumeInviteAndCreateUser(hashToken(inviteCode), now, {
      id,
      username,
      passwordHash: null,
      email,
      role: 'readonly',
      createdAt: now,
      updatedAt: now,
      createdBy: 'system',
    });
    if (outcome !== 'ok') return { ok: false, reason: outcome };
    userIdentitiesDb.linkIdentity(linkRow);
    return { ok: true, userId: id, isNew: true, linked: false };
  }

  const role = siteConfigDb.get().defaultUserRole ?? 'readonly';
  const created = tx(() => {
    if (usersDb.getUserByUsername(username)) return false;
    usersDb.createUser({
      id,
      username,
      passwordHash: null,
      email,
      role,
      createdAt: now,
      updatedAt: now,
      createdBy: 'system',
    });
    userIdentitiesDb.linkIdentity(linkRow);
    return true;
  });
  if (!created) return { ok: false, reason: 'username_taken' };
  return { ok: true, userId: id, isNew: true, linked: false };
}

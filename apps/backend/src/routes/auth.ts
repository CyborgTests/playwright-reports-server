import { randomUUID } from 'node:crypto';
import { capabilitiesFor, type Role } from '@playwright-reports/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { env } from '../config/env.js';
import { getEffectiveAccessMatrix } from '../lib/auth/access.js';
import { audit } from '../lib/auth/audit.js';
import { hashPassword, verifyPassword } from '../lib/auth/password.js';
import { allowAttempt, clearAttempts } from '../lib/auth/rateLimit.js';
import {
  AUTH_ENABLED,
  type AuthRequest,
  authorize,
  clearSessionCookies,
  csrfValid,
  generateCsrfToken,
  isAuthenticated,
  resolveIdentity,
  SESSION_COOKIE,
  setSessionCookies,
} from '../lib/auth/resolve.js';
import {
  changePasswordSchema,
  registerSchema,
  resetCompleteSchema,
  setupSchema,
  signinSchema,
} from '../lib/auth/schemas.js';
import {
  createSession,
  IDLE_TTL_MS,
  revokeAllSessionsForUser,
  revokeSession,
} from '../lib/auth/sessions.js';
import { hashToken, safeEqual } from '../lib/auth/tokens.js';
import {
  invitesDb,
  ROOT_USER_ID,
  resetTokensDb,
  sessionsDb,
  siteConfigDb,
  tx,
  usersDb,
} from '../lib/service/db/index.js';

// id null signals the SPA to hide the account menu and treat the app as un-gated.
function openModeUser() {
  return { id: null, username: null, role: 'admin' as const };
}

function authDisabled(reply: FastifyReply): boolean {
  if (AUTH_ENABLED) return false;
  reply.code(404).send({ error: 'Not found' });
  return true;
}

function rateLimited(reply: FastifyReply, name: string, ip: string): boolean {
  if (allowAttempt(`${name}:${ip}`)) return false;
  reply.code(429).send({ success: false, error: 'Too many attempts, try again later' });
  return true;
}

export async function registerAuthRoutes(fastify: FastifyInstance) {
  fastify.post('/api/auth/signin', async (request, reply) => {
    if (!AUTH_ENABLED) {
      return { success: true, user: openModeUser() };
    }

    const ip = request.ip || 'unknown';
    if (rateLimited(reply, 'signin', ip)) return;

    const parsed = signinSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Username and password are required' });
    }
    const { username, password } = parsed.data;

    const user = usersDb.getUserByUsername(username);
    const ok = user && !user.disabled && (await verifyPassword(password, user.passwordHash));
    if (!user || !ok) {
      audit('login_failed', { actor: user?.id ?? null, detail: username });
      // Generic message - don't reveal whether the username exists.
      return reply.code(401).send({ success: false, error: 'Invalid username or password' });
    }

    const { token } = createSession({
      userId: user.id,
      role: user.role,
      userAgent: request.headers['user-agent'] ?? null,
      ip,
    });
    const csrf = generateCsrfToken();
    setSessionCookies(reply, token, csrf);
    clearAttempts(`signin:${ip}`);
    audit(user.id === ROOT_USER_ID ? 'root_login' : 'login', { actor: user.id });

    return {
      success: true,
      user: { id: user.id, username: user.username, role: user.role },
    };
  });

  // First-admin bootstrap: gated by API_TOKEN, self-locks once any admin exists.
  fastify.post('/api/auth/setup', async (request, reply) => {
    if (authDisabled(reply)) return;
    if (usersDb.hasAnyAdmin()) {
      return reply.code(409).send({ success: false, error: 'Setup already completed' });
    }
    if (rateLimited(reply, 'setup', request.ip || 'unknown')) return;

    const parsed = setupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: parsed.error.issues[0]?.message ?? 'Invalid setup payload',
      });
    }
    const { apiToken, username, password } = parsed.data;
    if (!env.API_TOKEN || !safeEqual(apiToken, env.API_TOKEN)) {
      return reply.code(403).send({ success: false, error: 'Invalid setup token' });
    }

    const passwordHash = await hashPassword(password);
    const id = randomUUID();
    const now = new Date().toISOString();
    const created = usersDb.createUserIfNoAdmin({
      id,
      username,
      passwordHash,
      role: 'admin',
      createdAt: now,
      updatedAt: now,
      createdBy: 'system',
    });
    if (!created) {
      return reply.code(409).send({ success: false, error: 'Setup already completed' });
    }
    audit('setup', { actor: id, target: username });
    return { success: true, user: { id, username, role: 'admin' as const } };
  });

  fastify.post('/api/auth/register', async (request, reply) => {
    if (authDisabled(reply)) return;
    if (rateLimited(reply, 'register', request.ip || 'unknown')) return;

    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        error: parsed.error.issues[0]?.message ?? 'Invalid registration payload',
      });
    }
    const { inviteCode, username, password } = parsed.data;

    const passwordHash = await hashPassword(password);
    const id = randomUUID();
    const now = new Date().toISOString();
    const newUser = {
      id,
      username,
      passwordHash,
      role: 'readonly' as Role,
      createdAt: now,
      updatedAt: now,
      createdBy: null,
    };

    // Invite-created users take the invite's role (consumeInviteAndCreateUser
    // overrides it); open self-registration uses the admin-configured default.
    let registeredRole: Role = 'readonly';

    if (inviteCode) {
      const outcome = invitesDb.consumeInviteAndCreateUser(hashToken(inviteCode), now, newUser);
      if (outcome === 'invalid_invite') {
        return reply.code(400).send({ success: false, error: 'Invalid or expired invite' });
      }
      if (outcome === 'username_taken') {
        return reply.code(409).send({ success: false, error: 'Username already taken' });
      }
    } else {
      const siteConfig = siteConfigDb.get();
      if (!siteConfig.allowOpenRegistration) {
        return reply.code(403).send({ success: false, error: 'Registration requires an invite' });
      }
      registeredRole = siteConfig.defaultUserRole ?? 'readonly';
      // Atomic so concurrent same-username registrations can't both pass the check.
      const created = tx(() => {
        if (usersDb.getUserByUsername(username)) return false;
        usersDb.createUser({ ...newUser, role: registeredRole });
        return true;
      });
      if (!created) {
        return reply.code(409).send({ success: false, error: 'Username already taken' });
      }
    }

    audit('register', { actor: id, target: username });
    return { success: true, user: { id, username, role: registeredRole } };
  });

  fastify.post('/api/auth/change-password', async (request, reply) => {
    if (authDisabled(reply)) return;
    const ip = request.ip || 'unknown';
    if (rateLimited(reply, 'change-password', ip)) return;
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid payload' });
    }
    const { username, currentPassword, newPassword } = parsed.data;

    const user = usersDb.getUserByUsername(username);
    const ok = user && !user.disabled && (await verifyPassword(currentPassword, user.passwordHash));
    if (!user || !ok) {
      return reply.code(401).send({ success: false, error: 'Invalid username or password' });
    }

    usersDb.setUserPassword(user.id, await hashPassword(newPassword));
    revokeAllSessionsForUser(user.id);
    const { token } = createSession({
      userId: user.id,
      role: user.role,
      userAgent: request.headers['user-agent'] ?? null,
      ip,
    });
    setSessionCookies(reply, token, generateCsrfToken());
    clearAttempts(`change-password:${ip}`);
    audit('password_change', { actor: user.id });
    return { success: true, user: { id: user.id, username: user.username, role: user.role } };
  });

  fastify.post('/api/auth/reset', async (request, reply) => {
    if (authDisabled(reply)) return;
    const parsed = resetCompleteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid payload' });
    const { token, password } = parsed.data;

    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();
    const userId = tx<string | null>(() => {
      const t = resetTokensDb.getValidResetToken(hashToken(token), now);
      if (!t) return null;
      resetTokensDb.markResetTokenUsed(t.id, now);
      usersDb.setUserPassword(t.userId, passwordHash);
      sessionsDb.deleteSessionsByUser(t.userId); // revoke all sessions on reset
      return t.userId;
    });
    if (!userId) {
      return reply.code(400).send({ success: false, error: 'Invalid or expired reset token' });
    }
    audit('password_reset_complete', { actor: userId });
    return { success: true };
  });

  fastify.post('/api/auth/signout', (request, reply) => {
    const identity = resolveIdentity(request);
    request.auth = identity ?? undefined;
    // A valid session must present a matching CSRF token (double-submit). An
    // expired/absent session skips the check so logout stays idempotent.
    if (!csrfValid(request)) {
      return reply.code(403).send({ success: false, error: 'Invalid CSRF token' });
    }
    const token = request.cookies?.[SESSION_COOKIE];
    const all = (request.query as { all?: string } | undefined)?.all === 'true';
    if (token) {
      if (all && identity?.userId) {
        revokeAllSessionsForUser(identity.userId);
      } else {
        revokeSession(token);
      }
      if (identity?.userId) audit(all ? 'logout_all' : 'logout', { actor: identity.userId });
    }
    clearSessionCookies(reply);
    return { success: true, message: 'Signed out' };
  });

  fastify.get('/api/auth/session', async (request) => {
    if (!AUTH_ENABLED) {
      const user = openModeUser();
      return {
        authMode: 'open' as const,
        user,
        capabilities: capabilitiesFor(user.role),
        expires: new Date(Date.now() + IDLE_TTL_MS).toISOString(),
      };
    }

    const identity = resolveIdentity(request);
    const user =
      identity?.via === 'session' && identity.userId ? usersDb.getUserById(identity.userId) : null;
    if (!user) {
      // 200 (not 401) with needsSetup so the SPA can route to setup vs login.
      return { authMode: 'enabled' as const, user: null, needsSetup: !usersDb.hasAnyAdmin() };
    }

    return {
      authMode: 'enabled' as const,
      user: { id: user.id, username: user.username, role: user.role },
      capabilities: capabilitiesFor(user.role, getEffectiveAccessMatrix()),
      expires: new Date(Date.now() + IDLE_TTL_MS).toISOString(),
    };
  });
}

export { authorize, isAuthenticated };
export type { AuthRequest };

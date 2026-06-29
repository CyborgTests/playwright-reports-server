import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { CAPABILITIES, OAUTH_PROVIDER_IDS, type OAuthProviderId } from '@playwright-reports/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { audit } from '../lib/auth/audit.js';
import {
  getProvider,
  getProviderMode,
  listEnabledPublicProviders,
} from '../lib/auth/oauth/factory.js';
import { findOrProvision } from '../lib/auth/oauth/provision.js';
import { allowAttempt, clearAttempts } from '../lib/auth/rateLimit.js';
import {
  AUTH_ENABLED,
  authorize,
  generateCsrfToken,
  resolveIdentity,
  setSessionCookies,
} from '../lib/auth/resolve.js';
import { createSession } from '../lib/auth/sessions.js';
import { userIdentitiesDb, usersDb } from '../lib/service/db/index.js';

function parseProviderId(params: unknown): OAuthProviderId | null {
  const id = (params as { provider?: string }).provider;
  return OAUTH_PROVIDER_IDS.includes(id as OAuthProviderId) ? (id as OAuthProviderId) : null;
}

function safeCallback(raw: string | undefined): string {
  if (!raw) return '/';
  if (raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\')) return raw;
  return '/';
}

function loginError(provider: string, reason: string): string {
  return `/login?error=${encodeURIComponent(`oauth_${provider}_${reason}`)}`;
}

const OAUTH_STATE_COOKIE = 'pwrs_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;

interface OAuthState {
  provider: string;
  state: string;
  verifier: string;
  nonce: string;
  inviteCode?: string;
  linkUserId?: string;
  callbackUrl: string;
  exp: number;
}

function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function randomToken(): string {
  return randomBytes(24).toString('base64url');
}

function parseState(raw: string): OAuthState | null {
  try {
    const s = JSON.parse(raw) as OAuthState;
    return typeof s.exp === 'number' && Date.now() < s.exp ? s : null;
  } catch {
    return null;
  }
}

export async function registerOAuthRoutes(fastify: FastifyInstance) {
  fastify.get('/api/auth/providers', async () => {
    if (!AUTH_ENABLED) return { providers: [] };
    return { providers: listEnabledPublicProviders() };
  });

  fastify.get(
    '/api/auth/oauth/:provider/start',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!AUTH_ENABLED) return reply.code(404).send({ error: 'Not found' });
      const id = parseProviderId(request.params);
      if (!id) return reply.code(404).send({ error: 'Not found' });
      const provider = getProvider(id);
      if (!provider) return reply.code(404).send({ error: 'Not found' });

      const q = request.query as { callbackUrl?: string; inviteCode?: string; intent?: string };
      let linkUserId: string | undefined;
      if (q.intent === 'link') {
        const identity = resolveIdentity(request);
        if (identity?.via !== 'session' || !identity.userId) {
          return reply.code(401).send({ error: 'Login required to link an account' });
        }
        linkUserId = identity.userId;
      }

      const { verifier, challenge } = createPkce();
      const state = randomToken();
      const nonce = randomToken();
      try {
        const url = await provider.buildAuthUrl({ state, codeChallenge: challenge, nonce });
        const payload: OAuthState = {
          provider: id,
          state,
          verifier,
          nonce,
          inviteCode: q.inviteCode,
          linkUserId,
          callbackUrl: safeCallback(q.callbackUrl),
          exp: Date.now() + STATE_TTL_MS,
        };
        reply.setCookie(OAUTH_STATE_COOKIE, JSON.stringify(payload), {
          path: '/',
          httpOnly: true,
          secure: env.COOKIE_SECURE,
          sameSite: 'lax',
          maxAge: 600,
          signed: true,
        });
        return reply.redirect(url);
      } catch (err) {
        fastify.log.error({ err, provider: id }, 'oauth start failed');
        return reply.redirect(loginError(id, 'start'));
      }
    }
  );

  fastify.get(
    '/api/auth/oauth/:provider/callback',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!AUTH_ENABLED) return reply.code(404).send({ error: 'Not found' });
      const id = parseProviderId(request.params);
      if (!id) return reply.code(404).send({ error: 'Not found' });

      const ip = request.ip || 'unknown';
      if (!allowAttempt(`oauth:${ip}`)) {
        return reply.code(429).send({ error: 'Too many attempts, try again later' });
      }

      const raw = request.cookies?.[OAUTH_STATE_COOKIE];
      const unsigned = raw ? request.unsignCookie(raw) : null;
      const state = unsigned?.valid && unsigned.value ? parseState(unsigned.value) : null;
      reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });
      const q = request.query as { code?: string; state?: string; error?: string };

      if (q.error) {
        audit('oauth_login_failed', { detail: `${id}:${q.error}` });
        return reply.redirect(loginError(id, 'denied'));
      }
      if (!state || state.provider !== id || !q.code || q.state !== state.state) {
        audit('oauth_login_failed', { detail: `${id}:bad_state` });
        return reply.redirect(loginError(id, 'state'));
      }

      const provider = getProvider(id);
      if (!provider) return reply.redirect(loginError(id, 'disabled'));

      let profile: Awaited<ReturnType<typeof provider.authenticate>>;
      try {
        profile = await provider.authenticate(q.code, state.verifier, state.nonce);
      } catch (err) {
        fastify.log.error({ err, provider: id }, 'oauth callback failed');
        audit('oauth_login_failed', { detail: `${id}:exchange` });
        return reply.redirect(loginError(id, 'exchange'));
      }

      if (state.linkUserId) {
        const linkUser = usersDb.getUserById(state.linkUserId);
        if (!linkUser || linkUser.disabled) {
          return reply.redirect(loginError(id, 'account_disabled'));
        }
        const owner = userIdentitiesDb.findByProviderExternalId(id, profile.externalId);
        if (owner && owner.userId !== state.linkUserId) {
          return reply.redirect(loginError(id, 'already_linked'));
        }
        if (!owner) {
          userIdentitiesDb.linkIdentity({
            id: randomUUID(),
            userId: state.linkUserId,
            provider: id,
            externalId: profile.externalId,
            email: profile.email,
            emailVerified: profile.emailVerified,
            displayName: profile.displayName,
          });
          audit('oauth_link', { actor: state.linkUserId, detail: id });
        }
        clearAttempts(`oauth:${ip}`);
        return reply.redirect(safeCallback(state.callbackUrl));
      }

      const result = findOrProvision(id, profile, getProviderMode(id), state.inviteCode);
      if (!result.ok) {
        audit('oauth_login_failed', { detail: `${id}:${result.reason}` });
        return reply.redirect(loginError(id, result.reason));
      }

      const user = usersDb.getUserById(result.userId);
      if (!user) return reply.redirect(loginError(id, 'provision'));

      const { token } = createSession({
        userId: user.id,
        role: user.role,
        userAgent: request.headers['user-agent'] ?? null,
        ip,
      });
      setSessionCookies(reply, token, generateCsrfToken());
      clearAttempts(`oauth:${ip}`);
      if (result.isNew)
        audit('oauth_register', { actor: user.id, detail: id, target: user.username });
      else if (result.linked) audit('oauth_link', { actor: user.id, detail: id });
      audit('oauth_login', { actor: user.id, detail: id });

      return reply.redirect(safeCallback(state.callbackUrl));
    }
  );

  fastify.get('/api/auth/identities', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!AUTH_ENABLED) return reply.code(404).send({ error: 'Not found' });
    const guard = await authorize(CAPABILITIES.view)(request, reply);
    if (guard) return;
    const identity = request.auth;
    if (identity?.via !== 'session' || !identity.userId) {
      return reply.code(400).send({ error: 'Not a session user' });
    }
    const user = usersDb.getUserById(identity.userId);
    const identities = userIdentitiesDb.listByUserId(identity.userId).map((i) => ({
      provider: i.provider,
      email: i.email,
      displayName: i.displayName,
      createdAt: i.createdAt,
    }));
    return { hasPassword: !!user?.passwordHash, identities };
  });

  fastify.post(
    '/api/auth/oauth/:provider/unlink',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!AUTH_ENABLED) return reply.code(404).send({ error: 'Not found' });
      const guard = await authorize(CAPABILITIES.view)(request, reply);
      if (guard) return;
      const id = parseProviderId(request.params);
      if (!id) return reply.code(404).send({ error: 'Not found' });
      const identity = request.auth;
      if (identity?.via !== 'session' || !identity.userId) {
        return reply.code(400).send({ success: false, error: 'Not a session user' });
      }

      const user = usersDb.getUserById(identity.userId);
      const identities = userIdentitiesDb.listByUserId(identity.userId);
      const remaining = identities.filter((i) => i.provider !== id).length;
      if (!user?.passwordHash && remaining === 0) {
        return reply.code(400).send({
          success: false,
          error:
            'Cannot unlink your only sign-in method. Set a password or link another provider first.',
        });
      }
      userIdentitiesDb.unlinkIdentity(identity.userId, id);
      audit('oauth_unlink', { actor: identity.userId, detail: id });
      return { success: true };
    }
  );
}

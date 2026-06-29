import { type Capability, keyCan, type Role } from '@playwright-reports/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { can } from './access.js';
import { type AuthCapability, type AuthScope, resolveApiKey } from './apiKeys.js';
import { resolveSession } from './sessions.js';
import { generateToken, safeEqual } from './tokens.js';

// Open mode (no API_TOKEN) short-circuits to a synthetic admin and never touches
// the DB, so the no-auth path keeps its original behaviour and performance.
export const AUTH_ENABLED = !!env.API_TOKEN;

export const SESSION_COOKIE = 'pwrs_session';
export const CSRF_COOKIE = 'pwrs_csrf';
const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60; // matches the absolute session cap

export interface AuthIdentity {
  via: 'open' | 'session' | 'apikey' | 'root';
  userId: string | null;
  role: Role | null; // null for API keys (they carry scopes/capability)
  scopes: AuthScope[];
  capability: AuthCapability | null;
  sessionId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthIdentity;
  }
}

export type AuthRequest = FastifyRequest;

const OPEN_IDENTITY: AuthIdentity = {
  via: 'open',
  userId: null,
  role: 'admin',
  scopes: ['upload', 'cli'],
  capability: 'content',
  sessionId: null,
};

export function generateCsrfToken(): string {
  return generateToken();
}

export function resolveIdentity(request: FastifyRequest): AuthIdentity | null {
  if (!AUTH_ENABLED) return OPEN_IDENTITY;

  const sessionToken = request.cookies?.[SESSION_COOKIE];
  if (sessionToken) {
    const session = resolveSession(sessionToken);
    if (session) {
      return {
        via: 'session',
        userId: session.userId,
        // Carry the exact role; unknown values fall back to the least-privileged.
        role:
          session.role === 'admin' ? 'admin' : session.role === 'member' ? 'member' : 'readonly',
        scopes: [],
        capability: null,
        sessionId: session.id,
      };
    }
  }

  const header = request.headers.authorization;
  if (header) {
    const presented = header.startsWith('Bearer ') ? header.slice(7) : header;
    const key = resolveApiKey(presented);
    if (key) {
      return {
        via: 'apikey',
        userId: key.ownerUserId,
        role: null,
        scopes: key.scopes,
        capability: key.capability,
        sessionId: null,
      };
    }
  }

  return null;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Double-submit CSRF: only session-borne (cookie) mutations need it; API-key
// requests carry no cookie and are exempt.
export function csrfValid(request: FastifyRequest): boolean {
  if (request.auth?.via !== 'session') return true;
  if (!MUTATING_METHODS.has(request.method)) return true;
  const cookie = request.cookies?.[CSRF_COOKIE];
  const header = request.headers['x-csrf-token'];
  if (!cookie || typeof header !== 'string') return false;
  return safeEqual(cookie, header);
}

// Returns the reply on rejection (truthy) and undefined on success, so it works
// both as a `{ preHandler }` and as an inline `if (await authorize(cap)(...)) return`.
type GuardResult = Promise<FastifyReply | undefined>;

// Sessions authorize via the role matrix (`can`), API keys via `keyCan`.
export function authorize(capability: Capability) {
  return async (request: FastifyRequest, reply: FastifyReply): GuardResult => {
    const identity = resolveIdentity(request);
    if (!identity) return reply.code(401).send({ error: 'Unauthorized' });
    request.auth = identity;

    const allowed =
      identity.via === 'apikey'
        ? keyCan(identity.scopes, identity.capability ?? 'read', capability)
        : can(identity.role, capability);
    if (!allowed) return reply.code(403).send({ error: 'Forbidden' });

    if (!csrfValid(request)) return reply.code(403).send({ error: 'Invalid CSRF token' });
    return undefined;
  };
}

export function isAuthenticated(request: FastifyRequest): boolean {
  return resolveIdentity(request) !== null;
}

export function setSessionCookies(
  reply: FastifyReply,
  sessionToken: string,
  csrfToken: string
): void {
  reply.setCookie(SESSION_COOKIE, sessionToken, {
    path: '/',
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_S,
  });
  reply.setCookie(CSRF_COOKIE, csrfToken, {
    path: '/',
    httpOnly: false,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_S,
  });
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
}

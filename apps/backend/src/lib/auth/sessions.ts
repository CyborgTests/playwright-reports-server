import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { sessionsDb } from '../service/db/index.js';
import { generateToken, hashToken } from './tokens.js';

// Sliding idle TTL (from UI_AUTH_EXPIRE_HOURS) refreshed on activity, bounded by
// a hard absolute cap. Exported so route session responses report a consistent expiry.
const idleHours = Number.parseInt(env.UI_AUTH_EXPIRE_HOURS, 10);
export const IDLE_TTL_MS =
  (Number.isFinite(idleHours) && idleHours > 0 ? idleHours : 12) * 60 * 60 * 1000;
const ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Only persist a sliding refresh when the last one is older than this, so an
// active session doesn't write to the DB on every request.
const REFRESH_THROTTLE_MS = 5 * 60 * 1000;

export interface AuthedSession {
  id: string;
  userId: string;
  role: string;
}

export interface CreateSessionInput {
  userId: string;
  role: string;
  userAgent?: string | null;
  ip?: string | null;
}

export function createSession(input: CreateSessionInput): { token: string; expiresAt: string } {
  const token = generateToken();
  const now = Date.now();
  const expiresAt = new Date(now + ABSOLUTE_TTL_MS).toISOString();
  sessionsDb.insertSession({
    id: randomUUID(),
    tokenHash: hashToken(token),
    userId: input.userId,
    role: input.role,
    createdAt: new Date(now).toISOString(),
    expiresAt,
    idleExpiresAt: new Date(now + IDLE_TTL_MS).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    userAgent: input.userAgent ?? null,
    ip: input.ip ?? null,
  });
  return { token, expiresAt };
}

export function resolveSession(token: string): AuthedSession | null {
  const session = sessionsDb.getSessionByTokenHash(hashToken(token));
  if (!session) return null;

  const now = Date.now();
  if (now > Date.parse(session.expiresAt) || now > Date.parse(session.idleExpiresAt)) {
    sessionsDb.deleteSession(session.id); // opportunistic cleanup of an expired row
    return null;
  }

  if (now - Date.parse(session.lastSeenAt) > REFRESH_THROTTLE_MS) {
    // Extend the idle window, but never past the absolute cap.
    const idle = Math.min(now + IDLE_TTL_MS, Date.parse(session.expiresAt));
    sessionsDb.refreshSession(
      session.id,
      new Date(now).toISOString(),
      new Date(idle).toISOString()
    );
  }

  return { id: session.id, userId: session.userId, role: session.role };
}

export function revokeSession(token: string): void {
  sessionsDb.deleteSessionByTokenHash(hashToken(token));
}

export function revokeAllSessionsForUser(userId: string): number {
  return sessionsDb.deleteSessionsByUser(userId);
}

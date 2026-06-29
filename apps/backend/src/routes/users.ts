import { randomUUID } from 'node:crypto';
import { CAPABILITIES } from '@playwright-reports/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { audit } from '../lib/auth/audit.js';
import { assertNotLastAdmin, LastAdminError } from '../lib/auth/invariants.js';
import { authorize } from '../lib/auth/resolve.js';
import { updateUserSchema } from '../lib/auth/schemas.js';
import { generateToken, hashToken } from '../lib/auth/tokens.js';
import { pageResponse, parsePageQuery } from '../lib/pagination.js';
import {
  ROOT_USER_ID,
  resetTokensDb,
  sessionsDb,
  tx,
  type UserRecord,
  usersDb,
} from '../lib/service/db/index.js';

const RESET_TTL_MS = 24 * 60 * 60 * 1000;

function toPublic(u: UserRecord) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    disabled: !!u.disabled,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

function actorId(request: FastifyRequest): string | null {
  return request.auth?.userId ?? null;
}

export async function registerUsersRoutes(fastify: FastifyInstance) {
  await fastify.register(async (f) => {
    f.addHook('preHandler', authorize(CAPABILITIES.manageUsers));

    f.get('/api/users', async (request) => {
      const { page, limit, offset } = parsePageQuery(request.query);
      const includeDisabled =
        (request.query as { includeInactive?: string }).includeInactive === 'true';
      return pageResponse(
        usersDb.listUsersPaged(limit, offset, includeDisabled).map(toPublic),
        usersDb.countUsers(includeDisabled),
        page,
        limit
      );
    });

    f.patch('/api/users/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (id === ROOT_USER_ID) {
        return reply.code(403).send({ error: 'The root account cannot be modified' });
      }
      const parsed = updateUserSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });
      const target = usersDb.getUserById(id);
      if (!target) return reply.code(404).send({ error: 'User not found' });

      const { role, disabled } = parsed.data;
      try {
        tx(() => {
          if (disabled === true) {
            assertNotLastAdmin(id);
            usersDb.setUserDisabled(id, true);
          } else if (disabled === false) {
            usersDb.setUserDisabled(id, false);
          }
          if (role && role !== target.role) {
            // Any demotion away from admin must respect the last-admin invariant.
            if (role !== 'admin') assertNotLastAdmin(id);
            usersDb.setUserRole(id, role);
          }
          // Any role change / disable logs the user off immediately so cached
          // session roles can't go stale.
          if (role !== undefined || disabled !== undefined) sessionsDb.deleteSessionsByUser(id);
        });
      } catch (e) {
        if (e instanceof LastAdminError) return reply.code(409).send({ error: e.message });
        throw e;
      }
      if (disabled !== undefined) {
        audit(disabled ? 'user_disable' : 'user_enable', { actor: actorId(request), target: id });
      }
      if (role) audit('user_role_change', { actor: actorId(request), target: id, detail: role });
      const updated = usersDb.getUserById(id);
      return { user: updated ? toPublic(updated) : null };
    });

    f.delete('/api/users/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (id === ROOT_USER_ID) {
        return reply.code(403).send({ error: 'The root account cannot be deleted' });
      }
      if (!usersDb.getUserById(id)) return reply.code(404).send({ error: 'User not found' });
      try {
        tx(() => {
          assertNotLastAdmin(id);
          usersDb.deleteUser(id); // cascades sessions + personal API keys
        });
      } catch (e) {
        if (e instanceof LastAdminError) return reply.code(409).send({ error: e.message });
        throw e;
      }
      audit('user_delete', { actor: actorId(request), target: id });
      return { success: true };
    });

    // Issue a one-time reset link token (shown once; handed to the user out-of-band).
    f.post('/api/users/:id/reset', async (request, reply) => {
      const { id } = request.params as { id: string };
      if (id === ROOT_USER_ID || !usersDb.getUserById(id)) {
        return reply.code(404).send({ error: 'User not found' });
      }
      const token = generateToken();
      const now = Date.now();
      resetTokensDb.insertResetToken({
        id: randomUUID(),
        tokenHash: hashToken(token),
        userId: id,
        createdBy: actorId(request),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + RESET_TTL_MS).toISOString(),
        usedAt: null,
      });
      audit('password_reset_issue', { actor: actorId(request), target: id });
      return { resetToken: token, expiresInHours: RESET_TTL_MS / 3_600_000 };
    });
  });
}

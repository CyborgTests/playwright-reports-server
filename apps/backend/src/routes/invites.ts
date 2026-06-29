import { randomUUID } from 'node:crypto';
import { CAPABILITIES } from '@playwright-reports/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { audit } from '../lib/auth/audit.js';
import { authorize } from '../lib/auth/resolve.js';
import { createInviteSchema } from '../lib/auth/schemas.js';
import { generateToken, hashToken } from '../lib/auth/tokens.js';
import { pageResponse, parsePageQuery } from '../lib/pagination.js';
import { type InviteRecord, invitesDb } from '../lib/service/db/index.js';

function toPublic(i: InviteRecord, createdUsernames: string[] = []) {
  return {
    id: i.id,
    role: i.role,
    createdAt: i.createdAt,
    expiresAt: i.expiresAt,
    maxUses: i.maxUses,
    useCount: i.useCount,
    revokedAt: i.revokedAt,
    createdUsernames,
  };
}

function actorId(request: FastifyRequest): string | null {
  return request.auth?.userId ?? null;
}

export async function registerInvitesRoutes(fastify: FastifyInstance) {
  await fastify.register(async (f) => {
    f.addHook('preHandler', authorize(CAPABILITIES.manageInvites));

    f.get('/api/invites', async (request) => {
      const { page, limit, offset } = parsePageQuery(request.query);
      const includeRevoked =
        (request.query as { includeInactive?: string }).includeInactive === 'true';
      const byInvite = invitesDb.usernamesByInvite();
      return pageResponse(
        invitesDb
          .listInvitesPaged(limit, offset, includeRevoked)
          .map((i) => toPublic(i, byInvite.get(i.id) ?? [])),
        invitesDb.countInvites(includeRevoked),
        page,
        limit
      );
    });

    f.post('/api/invites', async (request, reply) => {
      const parsed = createInviteSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });
      const code = generateToken();
      const id = randomUUID();
      invitesDb.insertInvite({
        id,
        codeHash: hashToken(code),
        role: 'readonly', // new accounts start read-only; admins promote later
        createdBy: actorId(request),
        createdAt: new Date().toISOString(),
        expiresAt: parsed.data.expiresAt ?? null,
        maxUses: parsed.data.maxUses ?? null,
        useCount: 0,
        revokedAt: null,
      });
      audit('invite_create', { actor: actorId(request), target: id });
      const created = invitesDb.getInviteByHash(hashToken(code));
      // `code` is returned once for the admin to share; only its hash is stored.
      return reply.code(201).send({ code, invite: created ? toPublic(created) : null });
    });

    f.delete('/api/invites/:id', async (request) => {
      const { id } = request.params as { id: string };
      invitesDb.revokeInvite(id, new Date().toISOString());
      audit('invite_revoke', { actor: actorId(request), target: id });
      return { success: true };
    });
  });
}

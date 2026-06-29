import {
  CAPABILITIES,
  KEY_CAPABILITIES,
  KEY_SCOPES,
  KEY_TYPES,
  type KeyScope,
} from '@playwright-reports/shared';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { can } from '../lib/auth/access.js';
import { mintApiKey, parseScopes } from '../lib/auth/apiKeys.js';
import { audit } from '../lib/auth/audit.js';
import { authorize } from '../lib/auth/resolve.js';
import { createKeySchema } from '../lib/auth/schemas.js';
import { pageResponse, parsePageQuery } from '../lib/pagination.js';
import { type ApiKeyRecord, apiKeysDb, usersDb } from '../lib/service/db/index.js';

// The legacy seed key holds both scopes; it shows as `reporter + cli`.
function keyType(scopes: ReturnType<typeof parseScopes>): string {
  const hasUpload = scopes.includes(KEY_SCOPES.upload);
  const hasCli = scopes.includes(KEY_SCOPES.cli);
  if (hasUpload && hasCli) return `${KEY_TYPES.reporter} + ${KEY_TYPES.cli}`;
  return hasUpload ? KEY_TYPES.reporter : KEY_TYPES.cli;
}

function toPublic(k: ApiKeyRecord, ownerUsername: string | null = null) {
  const scopes = parseScopes(k.scopes);
  return {
    id: k.id,
    label: k.label,
    type: keyType(scopes),
    service: k.ownerUserId === null,
    ownerUserId: k.ownerUserId,
    ownerUsername,
    createdAt: k.createdAt,
    expiresAt: k.expiresAt,
    lastUsedAt: k.lastUsedAt,
    revokedAt: k.revokedAt,
  };
}

export async function registerApiKeysRoutes(fastify: FastifyInstance) {
  await fastify.register(async (f) => {
    f.addHook('preHandler', authorize(CAPABILITIES.apiKeysOwn));

    f.get('/api/keys', async (request: FastifyRequest) => {
      const { page, limit, offset } = parsePageQuery(request.query);
      if (can(request.auth?.role, CAPABILITIES.apiKeysService)) {
        const rows = apiKeysDb.listAllApiKeysPaged(limit, offset);
        // Resolve owner names only for this page's keys (not the whole user table).
        const ownerIds = [
          ...new Set(rows.map((k) => k.ownerUserId).filter((id): id is string => id !== null)),
        ];
        const usernameById = new Map(
          ownerIds.map((id) => [id, usersDb.getUserById(id)?.username ?? null])
        );
        const data = rows.map((k) =>
          toPublic(k, k.ownerUserId ? (usernameById.get(k.ownerUserId) ?? null) : null)
        );
        return pageResponse(data, apiKeysDb.countApiKeys(), page, limit);
      }
      const ownerId = request.auth?.userId ?? null;
      if (!ownerId) return pageResponse([], 0, page, limit);
      const data = apiKeysDb
        .listApiKeysByOwnerPaged(ownerId, limit, offset)
        .map((k) => toPublic(k));
      return pageResponse(data, apiKeysDb.countApiKeysByOwner(ownerId), page, limit);
    });

    f.post('/api/keys', async (request, reply) => {
      const parsed = createKeySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid payload' });
      const { label, type, expiresAt, service } = parsed.data;
      if (service && !can(request.auth?.role, CAPABILITIES.apiKeysService)) {
        return reply.code(403).send({ error: 'Only admins can create service keys' });
      }
      const ownerUserId = service ? null : (request.auth?.userId ?? null);
      // Preset → stored scopes; both presets are full-content within their surface.
      const scopes: KeyScope[] =
        type === KEY_TYPES.reporter ? [KEY_SCOPES.upload] : [KEY_SCOPES.cli];
      const minted = mintApiKey({
        label,
        scopes,
        capability: KEY_CAPABILITIES.content,
        ownerUserId,
        createdBy: request.auth?.userId ?? null,
        expiresAt: expiresAt ?? null,
      });
      audit('key_create', { actor: request.auth?.userId ?? null, target: minted.id });
      const created = apiKeysDb.getApiKeyById(minted.id);
      // `key` is the plaintext, returned exactly once.
      return reply.code(201).send({ key: minted.key, apiKey: created ? toPublic(created) : null });
    });

    f.delete('/api/keys/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const key = apiKeysDb.getApiKeyById(id);
      if (!key) return reply.code(404).send({ error: 'Key not found' });
      const isAdmin = can(request.auth?.role, CAPABILITIES.apiKeysService);
      const isOwner = key.ownerUserId !== null && key.ownerUserId === request.auth?.userId;
      // Service keys (no owner) are admin-only; personal keys: owner or admin.
      if (!isAdmin && !isOwner) return reply.code(403).send({ error: 'Forbidden' });
      apiKeysDb.revokeApiKey(id, new Date().toISOString());
      audit('key_revoke', { actor: request.auth?.userId ?? null, target: id });
      return { success: true };
    });
  });
}

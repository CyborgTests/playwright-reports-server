import {
  CAPABILITIES,
  OAUTH_PROVIDER_IDS,
  type OAuthConfig,
  type OAuthProviderConfig,
  type OAuthProvisioningMode,
  type OAuthSettings,
} from '@playwright-reports/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authorize } from '../lib/auth/resolve.js';
import { encryptToken } from '../lib/githubSync/encryption.js';
import { service } from '../lib/service/index.js';

const MODES: readonly OAuthProvisioningMode[] = ['invite_only', 'open'];

interface ProviderInput {
  enabled?: boolean;
  clientId?: string;
  clientSecret?: string;
  mode?: string;
  issuerUrl?: string;
}

function toSettings(cfg: OAuthConfig | undefined): OAuthSettings {
  const out = {} as OAuthSettings;
  for (const id of OAUTH_PROVIDER_IDS) {
    const p = cfg?.[id];
    out[id] = {
      enabled: p?.enabled ?? false,
      clientId: p?.clientId ?? '',
      mode: p?.mode === 'open' ? 'open' : 'invite_only',
      issuerUrl: p?.issuerUrl,
      secretSet: !!p?.clientSecret,
    };
  }
  return out;
}

function applyUpdate(
  current: OAuthProviderConfig | undefined,
  input: ProviderInput
): OAuthProviderConfig {
  const next: OAuthProviderConfig = current
    ? { ...current }
    : { enabled: false, clientId: '', mode: 'invite_only' };
  if (typeof input.enabled === 'boolean') next.enabled = input.enabled;
  if (typeof input.clientId === 'string') next.clientId = input.clientId.trim();
  if (typeof input.mode === 'string' && MODES.includes(input.mode as OAuthProvisioningMode)) {
    next.mode = input.mode as OAuthProvisioningMode;
  }
  if (typeof input.issuerUrl === 'string') next.issuerUrl = input.issuerUrl.trim() || undefined;
  if (typeof input.clientSecret === 'string') {
    const trimmed = input.clientSecret.trim();
    next.clientSecret = trimmed ? encryptToken(trimmed) : undefined;
  }
  return next;
}

export async function registerSsoConfigRoutes(fastify: FastifyInstance) {
  fastify.get('/api/config/sso', { preHandler: authorize(CAPABILITIES.configSso) }, async () => {
    const cfg = await service.getConfig();
    return { providers: toSettings(cfg.oauth) };
  });

  fastify.patch(
    '/api/config/sso',
    { preHandler: authorize(CAPABILITIES.configSso) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as Partial<Record<string, ProviderInput>>;
      const cfg = await service.getConfig();
      const oauth: OAuthConfig = { ...(cfg.oauth ?? {}) };

      for (const id of OAUTH_PROVIDER_IDS) {
        const input = body[id];
        if (!input || typeof input !== 'object') continue;
        const next = applyUpdate(oauth[id], input);
        if (next.enabled) {
          if (!next.clientId || !next.clientSecret) {
            return reply
              .code(400)
              .send({ error: `${id}: client id and secret are required to enable` });
          }
          if (id === 'oidc' && !next.issuerUrl) {
            return reply.code(400).send({ error: 'oidc: issuer URL is required to enable' });
          }
        }
        oauth[id] = next;
      }

      const saved = await service.updateConfig({ oauth });
      return { providers: toSettings(saved.oauth) };
    }
  );
}

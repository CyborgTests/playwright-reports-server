import {
  CAPABILITIES,
  OAUTH_PROVIDER_IDS,
  type OAuthConfig,
  type OAuthProviderConfig,
  type OAuthSettings,
} from '@playwright-reports/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authorize } from '../lib/auth/resolve.js';
import { encryptToken } from '../lib/githubSync/encryption.js';
import { service } from '../lib/service/index.js';

const providerInputSchema = z
  .object({
    enabled: z.boolean(),
    clientId: z.string(),
    clientSecret: z.string(),
    mode: z.enum(['invite_only', 'open']),
    issuerUrl: z.string(),
    allowedEmailDomains: z.array(z.string()),
  })
  .partial();

const ssoPatchSchema = z.object({
  github: providerInputSchema.optional(),
  google: providerInputSchema.optional(),
  oidc: providerInputSchema.optional(),
});

type ProviderInput = z.infer<typeof providerInputSchema>;

function normalizeDomains(input: string[]): string[] {
  const out = new Set<string>();
  for (const raw of input) {
    const domain = raw.trim().toLowerCase().replace(/^@/, '').replace(/^\.+/, '');
    if (domain) out.add(domain);
  }
  return [...out];
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
      allowedEmailDomains: p?.allowedEmailDomains ?? [],
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
  if (input.enabled !== undefined) next.enabled = input.enabled;
  if (input.clientId !== undefined) next.clientId = input.clientId.trim();
  if (input.mode !== undefined) next.mode = input.mode;
  if (input.issuerUrl !== undefined) next.issuerUrl = input.issuerUrl.trim() || undefined;
  if (input.clientSecret !== undefined) {
    const trimmed = input.clientSecret.trim();
    next.clientSecret = trimmed ? encryptToken(trimmed) : undefined;
  }
  if (input.allowedEmailDomains !== undefined) {
    const domains = normalizeDomains(input.allowedEmailDomains);
    next.allowedEmailDomains = domains.length > 0 ? domains : undefined;
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
      const parsed = ssoPatchSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          error: parsed.error.issues[0]?.message ?? 'Invalid SSO settings',
        });
      }
      const body = parsed.data;
      const cfg = await service.getConfig();
      const oauth: OAuthConfig = { ...(cfg.oauth ?? {}) };

      for (const id of OAUTH_PROVIDER_IDS) {
        const input = body[id];
        if (!input) continue;
        const next = applyUpdate(oauth[id], input);
        if (next.enabled) {
          if (!next.clientId || !next.clientSecret) {
            return reply.code(400).send({
              success: false,
              error: `${id}: client id and secret are required to enable`,
            });
          }
          if (id === 'oidc' && !next.issuerUrl) {
            return reply
              .code(400)
              .send({ success: false, error: 'oidc: issuer URL is required to enable' });
          }
        }
        oauth[id] = next;
      }

      const saved = await service.updateConfig({ oauth });
      return { providers: toSettings(saved.oauth) };
    }
  );
}

import {
  OAUTH_PROVIDER_IDS,
  type OAuthProviderId,
  type OAuthProvisioningMode,
  type OAuthPublicProvider,
} from '@playwright-reports/shared';
import { decryptToken } from '../../githubSync/encryption.js';
import { siteConfigDb } from '../../service/db/index.js';
import type { OAuthProvider } from './base.js';
import { GithubProvider } from './github.js';
import { GoogleProvider } from './google.js';
import { OidcProvider } from './oidc.js';
import type { ResolvedProviderConfig } from './types.js';

const DEFAULT_LABELS: Record<OAuthProviderId, string> = {
  github: 'GitHub',
  google: 'Google',
  oidc: 'SSO',
};

function serverBaseUrl(): string {
  return (siteConfigDb.get().serverBaseUrl ?? '').replace(/\/+$/, '');
}

export function redirectUriFor(id: OAuthProviderId): string | null {
  const base = serverBaseUrl();
  return base ? `${base}/api/auth/oauth/${id}/callback` : null;
}

export function getProviderMode(id: OAuthProviderId): OAuthProvisioningMode {
  return siteConfigDb.get().oauth?.[id]?.mode === 'open' ? 'open' : 'invite_only';
}

export function getProvider(id: OAuthProviderId): OAuthProvider | null {
  const cfg = siteConfigDb.get().oauth?.[id];
  if (!cfg || !cfg.enabled) return null;
  const clientSecret = decryptToken(cfg.clientSecret);
  if (!cfg.clientId || !clientSecret) return null;
  if (id === 'oidc' && !cfg.issuerUrl) return null;
  const redirectUri = redirectUriFor(id);
  if (!redirectUri) return null;

  const resolved: ResolvedProviderConfig = {
    id,
    clientId: cfg.clientId,
    clientSecret,
    issuerUrl: cfg.issuerUrl,
  };
  switch (id) {
    case 'github':
      return new GithubProvider(resolved, redirectUri);
    case 'google':
      return new GoogleProvider(resolved, redirectUri);
    case 'oidc':
      return new OidcProvider(resolved, redirectUri);
    default:
      return null;
  }
}

export function listEnabledPublicProviders(): OAuthPublicProvider[] {
  const oauth = siteConfigDb.get().oauth;
  if (!oauth) return [];
  const out: OAuthPublicProvider[] = [];
  for (const id of OAUTH_PROVIDER_IDS) {
    const cfg = oauth[id];
    const complete = !!cfg?.clientId && !!cfg?.clientSecret && (id !== 'oidc' || !!cfg?.issuerUrl);
    if (cfg?.enabled && complete) {
      out.push({ id, label: DEFAULT_LABELS[id] });
    }
  }
  return out;
}

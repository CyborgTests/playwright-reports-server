import { type AuthUrlOpts, OAuthProvider } from './base.js';
import {
  OAuthError,
  type OAuthProfile,
  type ResolvedProviderConfig,
  type TokenSet,
} from './types.js';

interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

interface OidcUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
}

export class OidcProvider extends OAuthProvider {
  private readonly issuerUrl: string;
  private discovered?: OidcDiscovery;

  constructor(config: ResolvedProviderConfig, redirectUri: string) {
    super(config, redirectUri);
    if (!config.issuerUrl) throw new OAuthError('oidc: issuerUrl not configured');
    this.issuerUrl = config.issuerUrl.replace(/\/+$/, '');
  }

  private async discover(): Promise<OidcDiscovery> {
    if (this.discovered) return this.discovered;
    const doc = await this.fetchJson<OidcDiscovery>(
      `${this.issuerUrl}/.well-known/openid-configuration`,
      { headers: { Accept: 'application/json' } }
    );
    if (!doc.userinfo_endpoint || !doc.token_endpoint || !doc.authorization_endpoint) {
      throw new OAuthError('oidc: discovery document is missing required endpoints');
    }
    this.discovered = doc;
    return doc;
  }

  async buildAuthUrl(opts: AuthUrlOpts): Promise<string> {
    const doc = await this.discover();
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: opts.state,
      code_challenge: opts.codeChallenge,
      code_challenge_method: 'S256',
      nonce: opts.nonce,
    });
    return `${doc.authorization_endpoint}?${params}`;
  }

  async exchangeCode(code: string, verifier: string): Promise<TokenSet> {
    const doc = await this.discover();
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    });
    const data = await this.fetchJson<{ access_token?: string }>(doc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!data.access_token) throw new OAuthError('oidc: no access_token');
    return { accessToken: data.access_token };
  }

  async fetchProfile(tokens: TokenSet): Promise<OAuthProfile> {
    const doc = await this.discover();
    const info = await this.fetchJson<OidcUserInfo>(doc.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const username = info.preferred_username ?? (info.email ? info.email.split('@')[0] : info.sub);
    return {
      externalId: info.sub,
      username,
      email: info.email ?? null,
      emailVerified: info.email_verified === true,
      displayName: info.name ?? username,
    };
  }
}

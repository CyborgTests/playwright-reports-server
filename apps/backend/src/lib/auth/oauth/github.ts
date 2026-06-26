import { type AuthUrlOpts, OAuthProvider } from './base.js';
import { OAuthError, type OAuthProfile, type TokenSet } from './types.js';

interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
}
interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

export class GithubProvider extends OAuthProvider {
  async buildAuthUrl(opts: AuthUrlOpts): Promise<string> {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.redirectUri,
      scope: 'read:user user:email',
      state: opts.state,
      allow_signup: 'false',
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  }

  async exchangeCode(code: string, _verifier: string): Promise<TokenSet> {
    const data = await this.fetchJson<{ access_token?: string; error?: string }>(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code,
          redirect_uri: this.redirectUri,
        }),
      }
    );
    if (!data.access_token) throw new OAuthError('github: no access_token');
    return { accessToken: data.access_token };
  }

  async fetchProfile(tokens: TokenSet): Promise<OAuthProfile> {
    const headers = {
      Authorization: `Bearer ${tokens.accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'playwright-reports-server',
    };
    const user = await this.fetchJson<GithubUser>('https://api.github.com/user', { headers });
    const emails = await this.fetchJson<GithubEmail[]>('https://api.github.com/user/emails', {
      headers,
    }).catch(() => [] as GithubEmail[]);
    const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    return {
      externalId: String(user.id),
      username: user.login,
      email: primary?.email ?? null,
      emailVerified: !!primary,
      displayName: user.name ?? user.login,
    };
  }
}

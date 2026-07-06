import { type AuthUrlOpts, OAuthProvider } from './base.js';
import { OAuthError, type OAuthProfile, type TokenSet } from './types.js';

interface GoogleUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
}

export class GoogleProvider extends OAuthProvider {
  async buildAuthUrl(opts: AuthUrlOpts): Promise<string> {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: opts.state,
      code_challenge: opts.codeChallenge,
      code_challenge_method: 'S256',
      nonce: opts.nonce,
      access_type: 'online',
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async exchangeCode(code: string, verifier: string): Promise<TokenSet> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    });
    const data = await this.fetchJson<{ access_token?: string }>(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      }
    );
    if (!data.access_token) throw new OAuthError('google: no access_token');
    return { accessToken: data.access_token };
  }

  async fetchProfile(tokens: TokenSet): Promise<OAuthProfile> {
    const info = await this.fetchJson<GoogleUserInfo>(
      'https://openidconnect.googleapis.com/v1/userinfo',
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
    );
    const username = info.email ? info.email.split('@')[0] : (info.given_name ?? info.sub);
    return {
      externalId: info.sub,
      username,
      email: info.email ?? null,
      emailVerified: info.email_verified === true,
      displayName: info.name ?? username,
    };
  }
}

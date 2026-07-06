import { withError } from '../../withError.js';
import {
  OAuthError,
  type OAuthProfile,
  type ResolvedProviderConfig,
  type TokenSet,
} from './types.js';

export interface AuthUrlOpts {
  state: string;
  codeChallenge: string;
  nonce: string;
}

const OAUTH_FETCH_TIMEOUT_MS = 10_000;

export abstract class OAuthProvider {
  constructor(
    protected readonly config: ResolvedProviderConfig,
    protected readonly redirectUri: string
  ) {}

  abstract buildAuthUrl(opts: AuthUrlOpts): Promise<string>;
  abstract exchangeCode(code: string, verifier: string): Promise<TokenSet>;
  abstract fetchProfile(tokens: TokenSet, nonce: string): Promise<OAuthProfile>;

  async authenticate(code: string, verifier: string, nonce: string): Promise<OAuthProfile> {
    const tokens = await this.exchangeCode(code, verifier);
    return this.fetchProfile(tokens, nonce);
  }

  protected async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    const { result, error } = await withError(
      fetch(url, { ...init, signal: AbortSignal.timeout(OAUTH_FETCH_TIMEOUT_MS) })
    );
    if (error || !result) {
      throw new OAuthError(`${this.config.id}: network error: ${error?.message ?? 'no response'}`);
    }
    if (!result.ok) {
      const text = await result.text().catch(() => '');
      throw new OAuthError(`${this.config.id}: ${url} -> ${result.status} ${text.slice(0, 200)}`);
    }
    return result.json() as Promise<T>;
  }
}

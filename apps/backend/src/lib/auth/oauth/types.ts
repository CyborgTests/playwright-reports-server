import type { OAuthProviderId } from '@playwright-reports/shared';

export interface OAuthProfile {
  externalId: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
}

export interface TokenSet {
  accessToken: string;
}

export interface ResolvedProviderConfig {
  id: OAuthProviderId;
  clientId: string;
  clientSecret: string;
  issuerUrl?: string;
}

export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthError';
  }
}

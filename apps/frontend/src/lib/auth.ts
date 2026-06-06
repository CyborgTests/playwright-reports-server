import { withBase } from './url';

export function authHeaders(): HeadersInit {
  const jwt = typeof window !== 'undefined' ? localStorage.getItem('jwtToken') : null;
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}

export interface AuthUser {
  apiToken: string;
  jwtToken: string;
}

export interface AuthSession {
  user?: AuthUser;
  expires?: string;
  success?: boolean;
  error?: string;
  ok?: boolean;
}

export interface AuthConfig {
  authRequired: boolean;
  database?: {
    sizeOnDisk?: string;
    estimatedRAM?: string;
    results?: number;
    reports?: number;
  };
  dataStorage?: string;
  s3Endpoint?: string;
  s3Bucket?: string;
  azureAccountName?: string;
  azureContainer?: string;
}

export const getAuthSession = (): Promise<AuthSession> => {
  return fetch(withBase('/api/auth/session'))
    .then((res) => res.json())
    .catch(() => ({ user: undefined, expires: '' }));
};

export const signOut = async (): Promise<void> => {
  await fetch(withBase('/api/auth/signout'), { method: 'POST' });
  localStorage.removeItem('jwtToken');
};

export const signIn = async (
  _provider: string,
  options?: { apiToken?: string; redirect?: boolean }
): Promise<AuthSession & { ok?: boolean; error?: string }> => {
  const response = await fetch(withBase('/api/auth/signin'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiToken: options?.apiToken,
      redirect: options?.redirect !== false,
    }),
  });

  const result = await response.json();
  return {
    ...result,
    ok: response.ok,
    error: response.ok ? undefined : result.error,
  };
};

export const getProviders = () => {
  return Promise.resolve({
    credentials: {
      name: process.env.NODE_ENV === 'development' ? 'No Auth' : 'credentials',
      id: 'credentials',
    },
  });
};

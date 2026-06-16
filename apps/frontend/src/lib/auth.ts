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

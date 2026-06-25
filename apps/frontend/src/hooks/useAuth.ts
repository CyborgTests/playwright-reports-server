import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { type AuthUser, authHeaders, type SessionResponse } from '../lib/auth';
import { withBase } from '../lib/url';

export interface AuthSession {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  data: { user: AuthUser; authMode: 'open' | 'enabled' } | null;
  needsSetup: boolean;
}

// Cookie-based; only CSRF is added. Keeps the `session` param for call-site compat.
export function authHeadersForSession(_session: AuthSession): HeadersInit {
  return authHeaders();
}

export function useAuth(): AuthSession {
  const { data, isLoading, error } = useQuery<SessionResponse>({
    queryKey: ['auth-session'],
    queryFn: async () => {
      const response = await fetch(withBase('/api/auth/session'), { credentials: 'include' });
      if (!response.ok) {
        if (response.status === 401) throw new Error('Unauthorized');
        if (response.status === 404) return {};
        throw new Error('Failed to get session');
      }
      return response.json();
    },
    retry: false,
    staleTime: 60000,
  });

  return useMemo<AuthSession>(() => {
    if (isLoading) return { status: 'loading', data: null, needsSetup: false };
    if (error) return { status: 'unauthenticated', data: null, needsSetup: false };

    const user = data?.user ?? null;
    if (!user) {
      return { status: 'unauthenticated', data: null, needsSetup: !!data?.needsSetup };
    }
    return {
      status: 'authenticated',
      data: { user, authMode: data?.authMode ?? 'enabled' },
      needsSetup: false,
    };
  }, [data, isLoading, error]);
}

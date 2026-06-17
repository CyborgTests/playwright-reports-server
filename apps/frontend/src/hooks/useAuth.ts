import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { AuthUser } from '../lib/auth';
import { withBase } from '../lib/url';

const AUTHENTICATED_SESSION = {
  status: 'authenticated' as const,
  data: null,
};

const LOADING_SESSION = {
  status: 'loading' as const,
  data: null,
};

const UNAUTHENTICATED_SESSION = {
  status: 'unauthenticated' as const,
  data: null,
};

export interface AuthSession {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  data: { user: AuthUser } | null;
}

export function authHeadersForSession(session: AuthSession): HeadersInit {
  const jwt = typeof window !== 'undefined' ? localStorage.getItem('jwtToken') : null;
  if (jwt && session.status === 'authenticated' && session.data !== null) {
    return { Authorization: `Bearer ${jwt}` };
  }
  return {};
}

export function useAuth(): AuthSession {
  const { data, isLoading, error } = useQuery<{
    user?: AuthUser;
    expires: string;
  }>({
    queryKey: ['auth-session'],
    queryFn: async () => {
      const response = await fetch(withBase('/api/auth/session'));
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Unauthorized');
        }
        if (response.status === 404) {
          return { user: undefined, expires: '' };
        }
        throw new Error('Failed to get session');
      }
      return response.json();
    },
    retry: false,
    staleTime: 60000,
  });

  return useMemo(() => {
    if (isLoading) {
      return LOADING_SESSION;
    }

    if (error) {
      return UNAUTHENTICATED_SESSION;
    }

    if (!data?.user) {
      return AUTHENTICATED_SESSION;
    }

    if (data.user.apiToken === '') {
      return AUTHENTICATED_SESSION;
    }

    return {
      status: 'authenticated',
      data: {
        user: data.user,
      },
    };
  }, [data, isLoading, error]);
}

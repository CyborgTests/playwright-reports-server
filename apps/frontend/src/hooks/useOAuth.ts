import { useQueryClient, useQuery as useTanStackQuery } from '@tanstack/react-query';
import { getOAuthProviders, type IdentitiesResponse } from '@/lib/auth';
import appUseMutation from './useMutation';
import appUseQuery from './useQuery';

const IDENTITIES_KEY = '/api/auth/identities';

export function useOAuthProviders() {
  return useTanStackQuery({
    queryKey: ['oauth-providers'],
    queryFn: getOAuthProviders,
    staleTime: 5 * 60 * 1000,
  });
}

export function useOAuthIdentities() {
  return appUseQuery<IdentitiesResponse>(IDENTITIES_KEY, { staleTime: 60_000 });
}

export function useUnlinkProvider() {
  const queryClient = useQueryClient();
  return appUseMutation('/api/auth/oauth', {
    method: 'POST',
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [IDENTITIES_KEY] }),
  });
}

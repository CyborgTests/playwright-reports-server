'use client';

import { useQuery } from '@tanstack/react-query';

import { SiteWhiteLabelConfig } from '@/app/types';

export function useAuthConfig() {
  const { data: config, isLoading } = useQuery<SiteWhiteLabelConfig>({
    queryKey: ['auth-config'],
    queryFn: async () => {
      const response = await fetch('/api/config');

      if (!response.ok) {
        throw new Error('Failed to fetch config');
      }

      return response.json();
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 2,
  });

  return {
    authRequired: config?.authRequired ?? null,
    config: config ?? null,
    isLoading,
  };
}

'use client';

import { Button } from '@heroui/react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

import useMutation from '@/app/hooks/useMutation';
import { invalidateCache } from '@/app/lib/query-cache';

interface ServerCacheProps {
  isEnabled?: boolean;
}

export default function ServerCache({ isEnabled }: ServerCacheProps) {
  const queryClient = useQueryClient();
  const {
    mutate: cacheRefresh,
    isPending,
    error,
  } = useMutation('/api/cache/refresh', {
    method: 'POST',
    onSuccess: () => {
      invalidateCache(queryClient, { queryKeys: ['/api'] });
      toast.success(`cache refreshed successfully`);
    },
  });

  return (
    <div className="flex flex-row gap-2 items-center">
      <p className="text-sm text-gray-600">{isEnabled ? 'Enabled' : 'Disabled'}</p>
      {isEnabled && (
        <Button
          color="warning"
          isLoading={isPending}
          size="sm"
          onPress={() => {
            cacheRefresh({});
          }}
        >
          Force Refresh
        </Button>
      )}
      {error && toast.error(error.message)}
    </div>
  );
}

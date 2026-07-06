import type { QueryClient } from '@tanstack/react-query';

export const invalidateCache = async (
  queryClient: QueryClient,
  options?: { queryKeys?: string[]; predicate?: string }
) => {
  try {
    if (options?.queryKeys) {
      for (const key of options.queryKeys) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    }

    if (options?.predicate) {
      const needle = options.predicate;
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey.some((key) => typeof key === 'string' && key.includes(needle)),
      });
    }
  } catch (error) {
    console.error('Failed to invalidate cache:', error);
  }
};

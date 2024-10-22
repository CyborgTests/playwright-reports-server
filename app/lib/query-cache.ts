import { type QueryClient } from '@tanstack/react-query';

interface InvalidateCacheOptions {
  queryKeys?: string[];
  predicate?: string;
}

export const invalidateCache = (client: QueryClient, options: InvalidateCacheOptions) => {
  if (options?.queryKeys) {
    client.invalidateQueries({ queryKey: options.queryKeys });
  }

  if (options?.predicate) {
    client.invalidateQueries({
      predicate: (q) => q.queryKey.some((key) => typeof key === 'string' && key.startsWith(options.predicate!)),
    });
  }
};

import { type UseMutationOptions, useMutation as useTanStackMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { withBase } from '../lib/url';
import { authHeadersForSession, useAuth } from './useAuth';

type MutationFnParams<TVariables> = {
  body?: TVariables;
  path?: string;
};

const useMutation = <TData = unknown, TVariables = unknown>(
  url: string,
  options?: Omit<UseMutationOptions<TData, Error, MutationFnParams<TVariables>>, 'mutationFn'> & {
    method?: string;
  }
) => {
  const session = useAuth();

  return useTanStackMutation<TData, Error, MutationFnParams<TVariables>>({
    mutationFn: async ({ body, path }: MutationFnParams<TVariables>) => {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...authHeadersForSession(session),
      };

      const fullPath = withBase(path ?? url);
      const response = await fetch(fullPath, {
        headers:
          body && Object.keys(body).length > 0
            ? headers
            : {
                ...headers,
                'Content-Type': 'text/plain',
              },
        body: body && Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
        method: options?.method ?? 'POST',
      });
      const respText = await response.text();

      if (!response.ok) {
        toast.error(`Network response was not ok: ${respText}`);
        throw new Error(`Network response was not ok: ${respText}`);
      }

      return JSON.parse(respText);
    },
    ...options,
  });
};

export default useMutation;

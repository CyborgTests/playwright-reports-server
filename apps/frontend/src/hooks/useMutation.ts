import {
  type UseMutationOptions,
  useQueryClient,
  useMutation as useTanStackMutation,
} from '@tanstack/react-query';
import { toast } from 'sonner';

import { extractResponseError } from '../lib/api';
import { withBase } from '../lib/url';
import { authHeadersForSession, useAuth } from './useAuth';

type MutationFnParams<TVariables> = {
  body?: TVariables;
  path?: string;
};

const useMutation = <TData = unknown, TVariables = unknown, TContext = unknown>(
  url: string,
  options?: Omit<
    UseMutationOptions<TData, Error, MutationFnParams<TVariables>, TContext>,
    'mutationFn'
  > & {
    method?: string;
    silent?: boolean;
  }
) => {
  const session = useAuth();
  const queryClient = useQueryClient();
  const { method, silent, ...mutationOptions } = options ?? {};

  return useTanStackMutation<TData, Error, MutationFnParams<TVariables>, TContext>({
    mutationFn: async ({ body, path }: MutationFnParams<TVariables>) => {
      const auth = authHeadersForSession(session);
      const isForm = body instanceof FormData;
      const hasJsonBody =
        !isForm && body != null && (typeof body !== 'object' || Object.keys(body).length > 0);
      const headers: HeadersInit = isForm
        ? auth
        : { 'Content-Type': hasJsonBody ? 'application/json' : 'text/plain', ...auth };

      const response = await fetch(withBase(path ?? url), {
        headers,
        credentials: 'include',
        body: isForm ? (body as FormData) : hasJsonBody ? JSON.stringify(body) : undefined,
        method: method ?? 'POST',
      });
      const respText = await response.text();

      if (response.status === 401) {
        queryClient.invalidateQueries({ queryKey: ['auth-session'] });
        throw new Error('Unauthorized');
      }

      if (!response.ok) {
        const message = extractResponseError(respText, response.status);
        if (!silent) toast.error(message);
        throw new Error(message);
      }

      return respText ? (JSON.parse(respText) as TData) : (undefined as TData);
    },
    ...mutationOptions,
  });
};

export default useMutation;

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
    silent?: boolean;
  }
) => {
  const session = useAuth();
  const { method, silent, ...mutationOptions } = options ?? {};

  return useTanStackMutation<TData, Error, MutationFnParams<TVariables>>({
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
        body: isForm ? (body as FormData) : hasJsonBody ? JSON.stringify(body) : undefined,
        method: method ?? 'POST',
      });
      const respText = await response.text();

      if (!response.ok) {
        const message = respText || `Request failed (${response.status})`;
        if (!silent) toast.error(message);
        throw new Error(message);
      }

      return respText ? (JSON.parse(respText) as TData) : (undefined as TData);
    },
    ...mutationOptions,
  });
};

export default useMutation;

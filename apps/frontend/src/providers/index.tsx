import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ThemeProviderProps } from 'next-themes';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { type FC, lazy, Suspense, useState } from 'react';
import { CONFIG_QUERY_KEY, fetchConfig } from '../hooks/useConfig';

const THEME_VALUE_MAP = {
  'light-mode': 'light',
  'dark-mode': 'dark',
};

const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-query-devtools').then((m) => ({ default: m.ReactQueryDevtools }))
    )
  : null;

export const Providers: FC<ThemeProviderProps> = ({ children, ...themeProps }) => {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 5 * 60 * 1000, // 5 minutes
          refetchOnWindowFocus: false,
        },
      },
    });
    client.prefetchQuery({
      queryKey: CONFIG_QUERY_KEY,
      queryFn: fetchConfig,
    });
    return client;
  });

  return (
    <NextThemesProvider {...themeProps} attribute="class" value={THEME_VALUE_MAP}>
      <QueryClientProvider client={queryClient}>
        {children}
        {ReactQueryDevtools && (
          <Suspense fallback={null}>
            <ReactQueryDevtools initialIsOpen={false} />
          </Suspense>
        )}
      </QueryClientProvider>
    </NextThemesProvider>
  );
};

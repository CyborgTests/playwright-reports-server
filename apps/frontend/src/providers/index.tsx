import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import type { ThemeProviderProps } from 'next-themes';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { type FC, useState } from 'react';
import { CONFIG_QUERY_KEY, fetchConfig } from '../hooks/useConfig';

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
    <NextThemesProvider
      {...themeProps}
      attribute="class"
      // additional mapping to handle theme names from playwright trace view
      value={{
        'light-mode': 'light',
        'dark-mode': 'dark',
      }}
    >
      <QueryClientProvider client={queryClient}>
        {children}
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </NextThemesProvider>
  );
};

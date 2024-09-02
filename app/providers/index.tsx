'use client';
import React from 'react';
import { NextUIProvider } from '@nextui-org/system';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { ThemeProviderProps } from 'next-themes/dist/types';
import { useRouter } from 'next/navigation';

import { ApiTokenProvider } from './ApiTokenProvider';

export const Providers: React.FC<ThemeProviderProps> = ({ children, ...themeProps }) => {
  const router = useRouter();

  return (
    <NextUIProvider navigate={router.push}>
      <NextThemesProvider {...themeProps}>
        <ApiTokenProvider>{children}</ApiTokenProvider>
      </NextThemesProvider>
    </NextUIProvider>
  );
};

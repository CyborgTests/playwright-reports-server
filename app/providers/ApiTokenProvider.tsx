'use client';

import { usePathname, useRouter } from 'next/navigation';
import React, { useLayoutEffect, useMemo, useState } from 'react';

import { env } from '@/app/config/env';

interface ApiTokenContextType {
  apiToken: string;
  updateApiToken: (newValue?: string) => void;
}

const ApiTokenContext = React.createContext<ApiTokenContextType | null>(null);

export function ApiTokenProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [apiToken, setApiToken] = useState<string>(env.API_TOKEN ?? '');
  const router = useRouter();
  const pathname = usePathname();

  useLayoutEffect(() => {
    if (!apiToken && pathname !== '/login') {
      router.push('/login');
    }
  }, []);

  const updateApiToken = (newValue?: string) => {
    newValue && setApiToken(newValue);
  };

  const value = useMemo(() => ({ apiToken, updateApiToken }), [apiToken]);

  return <ApiTokenContext.Provider value={value}>{children}</ApiTokenContext.Provider>;
}

export function useApiToken(): ApiTokenContextType {
  const context = React.useContext(ApiTokenContext);

  if (!context) {
    throw new Error('useApiToken must be used within an AuthProvider');
  }

  return context;
}

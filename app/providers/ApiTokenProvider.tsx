'use client';

import { usePathname, useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';

import { getApiTokenFromEnv } from '@/app/actions/env';
import { getExistingToken } from '@/app/config/auth';

interface ApiTokenContextType {
  apiToken: string;
  isRequiredAuth: boolean;
  updateApiToken: (newValue?: string) => void;
}

const ApiTokenContext = React.createContext<ApiTokenContextType | null>(null);

export function ApiTokenProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [isRequiredAuth, setIsRequiredAuth] = useState(true);
  const [apiToken, setApiToken] = useState<string>('');
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    getApiTokenFromEnv().then((token) => {
      token && setApiToken(token);
      setIsRequiredAuth(!token);
    });
  }, []);

  useEffect(() => {
    const hashedClientToken = getExistingToken();

    if (isRequiredAuth && pathname !== '/login' && !hashedClientToken) {
      router.push('/login');
    }
  }, []);

  const updateApiToken = (newValue?: string) => {
    newValue && setApiToken(newValue);
  };

  const value = useMemo(() => ({ apiToken, updateApiToken, isRequiredAuth }), [apiToken, isRequiredAuth]);

  return <ApiTokenContext.Provider value={value}>{children}</ApiTokenContext.Provider>;
}

export function useApiToken(): ApiTokenContextType {
  const context = React.useContext(ApiTokenContext);

  if (!context) {
    throw new Error('useApiToken must be used within an AuthProvider');
  }

  return context;
}

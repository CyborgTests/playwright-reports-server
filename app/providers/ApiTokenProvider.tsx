'use client';

import { usePathname, useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';

import { getEnvVariables } from '@/app/actions/env';
import { getExistingToken } from '@/app/config/auth';

interface ApiTokenContextType {
  apiToken: string;
  expirationHours: number;
  isRequiredAuth: boolean;
  updateApiToken: (newValue?: string) => void;
}

const ApiTokenContext = React.createContext<ApiTokenContextType | null>(null);

export function ApiTokenProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [isRequiredAuth, setIsRequiredAuth] = useState(true);
  const [expirationHours, setExpirationHours] = useState(12);
  const [apiToken, setApiToken] = useState<string>('');
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    getEnvVariables().then(({ token, expirationHours }) => {
      token && setApiToken(token);
      setIsRequiredAuth(!token);
      !!expirationHours && setExpirationHours(parseInt(expirationHours, 10));
    });
  }, []);

  useEffect(() => {
    const hashedClientToken = getExistingToken(expirationHours);

    if (isRequiredAuth && pathname !== '/login' && !hashedClientToken) {
      router.push('/login');
    }
  }, []);

  const updateApiToken = (newValue?: string) => {
    newValue && setApiToken(newValue);
  };

  const value = useMemo(
    () => ({ apiToken, expirationHours, updateApiToken, isRequiredAuth }),
    [apiToken, isRequiredAuth],
  );

  return <ApiTokenContext.Provider value={value}>{children}</ApiTokenContext.Provider>;
}

export function useApiToken(): ApiTokenContextType {
  const context = React.useContext(ApiTokenContext);

  if (!context) {
    throw new Error('useApiToken must be used within an AuthProvider');
  }

  return context;
}

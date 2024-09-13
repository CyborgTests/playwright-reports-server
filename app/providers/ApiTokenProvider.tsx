'use client';

import React, { useEffect, useMemo, useState } from 'react';

import { getEnvVariables } from '@/app/actions/env';
import { getExistingToken, hashToken } from '@/app/config/auth';

interface ApiTokenContextType {
  apiToken: string;
  expirationHours: number;
  isRequiredAuth: boolean;
  updateExpirationHours: (newValue?: number) => void;
  updateApiToken: (newValue?: string) => void;
  isClientAuthorized: () => boolean;
}

const ApiTokenContext = React.createContext<ApiTokenContextType | null>(null);

export function ApiTokenProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [isRequiredAuth, setIsRequiredAuth] = useState(true);
  const [expirationHours, setExpirationHours] = useState(12);
  const [apiToken, setApiToken] = useState<string>('');

  useEffect(() => {
    getEnvVariables().then(({ token, expirationHours }) => {
      token && setApiToken(token);
      setIsRequiredAuth(!!token);
      !!expirationHours && setExpirationHours(parseInt(expirationHours, 10));
    });
  }, []);

  const updateApiToken = (newValue?: string) => {
    newValue && setApiToken(newValue);
  };

  const updateExpirationHours = (newValue?: number) => {
    !!newValue && setExpirationHours(newValue);
  };

  const isClientAuthorized = () => {
    if (!isRequiredAuth) {
      return true;
    }

    if (!apiToken) {
      return false;
    }

    return getExistingToken(expirationHours) === hashToken(apiToken);
  };

  const value = useMemo(
    () => ({ apiToken, expirationHours, updateApiToken, updateExpirationHours, isClientAuthorized, isRequiredAuth }),
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

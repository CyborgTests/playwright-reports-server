import { useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';

interface ApiTokenContextType {
  apiToken: string;
  updateApiToken: (newValue?: string) => void;
}

const ApiTokenContext = React.createContext<ApiTokenContextType | null>(null);

export function ApiTokenProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [apiToken, setApiToken] = useState<string>('');
  const router = useRouter();

  useEffect(() => {
    if (!apiToken) {
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

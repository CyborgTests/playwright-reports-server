import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

type AuthContextType = {
  apiToken: string;
  setApiToken: (v: string) => void;
  isLoggedIn: boolean;
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  requireAuth: boolean;
  authHeader: Record<string, string>;
};

const AuthContext = createContext<AuthContextType | null>(null);

const requireAuth = import.meta.env.VITE_REQUIRE_AUTH === true || import.meta.env.VITE_REQUIRE_AUTH === 'true';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [apiToken, setApiToken] = useState(localStorage.getItem('api_token') || '');
  const [isLoggedIn, setIsLoggedIn] = useState(!requireAuth || !!localStorage.getItem('api_token'));

  const login = useCallback(async (token: string) => {
    localStorage.setItem('api_token', token);
    setApiToken(token);
    setIsLoggedIn(true);
    await fetch('/api/session', {
      method: 'POST',
      headers: { Authorization: token },
      credentials: 'include',
    });
  }, []);

  const logout = useCallback(async () => {
    const t = localStorage.getItem('api_token') || '';
    await fetch('/api/session', {
      method: 'DELETE',
      credentials: 'include',
      headers: t ? { Authorization: t } : {},
    });
    localStorage.removeItem('api_token');
    setApiToken('');
    setIsLoggedIn(false);
  }, []);

  useEffect(() => {
    const t = localStorage.getItem('api_token');
    if (!t) return;
    void fetch('/api/session', {
      method: 'POST',
      headers: { Authorization: t },
      credentials: 'include',
    });
  }, []);

  const authHeader = apiToken ? { Authorization: apiToken } : {};

  return (
    <AuthContext.Provider value={{ apiToken, setApiToken, isLoggedIn, login, logout, requireAuth, authHeader }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

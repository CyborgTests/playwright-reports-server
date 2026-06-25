import { withBase } from './url';

// The session rides an httpOnly cookie; the SPA only adds the double-submit CSRF
// token from the readable `pwrs_csrf` cookie, so every authHeaders() call sends it.
export function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)pwrs_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function authHeaders(): HeadersInit {
  const csrf = getCsrfToken();
  return csrf ? { 'X-CSRF-Token': csrf } : {};
}

export type UserRole = 'admin' | 'reader' | 'readonly';

export interface AuthUser {
  id: string | null;
  username: string | null;
  role: UserRole;
}

export interface SessionResponse {
  authMode?: 'open' | 'enabled';
  user?: AuthUser | null;
  needsSetup?: boolean;
  expires?: string;
}

export interface AuthResult {
  ok: boolean;
  error?: string;
  user?: AuthUser;
}

async function postAuth(path: string, body: unknown): Promise<AuthResult> {
  const response = await fetch(withBase(path), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    error: response.ok ? undefined : result.error,
    user: result.user,
  };
}

export const signIn = (username: string, password: string): Promise<AuthResult> =>
  postAuth('/api/auth/signin', { username, password });

export const changePassword = (
  username: string,
  currentPassword: string,
  newPassword: string
): Promise<AuthResult> =>
  postAuth('/api/auth/change-password', { username, currentPassword, newPassword });

export const setupAdmin = (
  apiToken: string,
  username: string,
  password: string
): Promise<AuthResult> => postAuth('/api/auth/setup', { apiToken, username, password });

export const registerWithInvite = (
  inviteCode: string,
  username: string,
  password: string
): Promise<AuthResult> =>
  postAuth('/api/auth/register', {
    username,
    password,
    // Omit when blank so the backend takes the open-registration path.
    ...(inviteCode.trim() ? { inviteCode: inviteCode.trim() } : {}),
  });

export const resetPassword = (token: string, password: string): Promise<AuthResult> =>
  postAuth('/api/auth/reset', { token, password });

export const signOut = async (all = false): Promise<void> => {
  await fetch(withBase(`/api/auth/signout${all ? '?all=true' : ''}`), {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(),
  });
};

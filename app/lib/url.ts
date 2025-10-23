import { env } from '../config/env';

export const withBase = (p = '') => {
  const base = (env.API_BASE_PATH || '').replace(/\/+$/, '');
  const path = p.startsWith('/') ? p : `/${p}`;

  return `${base}${path}`;
};

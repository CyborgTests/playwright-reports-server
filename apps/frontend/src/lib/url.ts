const getApiUrl = (): string => {
  // In dockerized environment frontend and backend are served from the same origin.
  // Use relative paths by default so API calls go to the same host:port that serves the frontend.
  // VITE_API_URL should ONLY be set for cross-origin deployments (e.g., separate frontend/backend servers).
  if (import.meta.env?.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  return '';
};

export const buildUrl = (path: string, params?: Record<string, string>): string => {
  const baseUrl = getApiUrl();

  // relative URL for same origin deployment
  if (!baseUrl) {
    let url = path.startsWith('/') ? path : `/${path}`;

    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          searchParams.set(key, value);
        }
      });
      const paramString = searchParams.toString();
      if (paramString) {
        url += url.includes('?') ? `&${paramString}` : `?${paramString}`;
      }
    }

    return url;
  }

  // For cross-origin deployment when baseUrl is specified
  const url = new URL(path, baseUrl);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    });
  }
  return url.toString();
};

// Absolute link for out-of-band sharing: prefers the configured Server Base URL,
// falls back to the current origin.
export const shareLink = (path: string, serverBaseUrl?: string | null): string => {
  const base = serverBaseUrl?.trim().replace(/\/+$/, '');
  const origin = base || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
};

export const withBase = (path: string): string => {
  if (path.startsWith('http')) {
    return path;
  }

  const baseUrl = getApiUrl();
  // If baseUrl is empty (same-origin deployment), just return the relative path
  if (!baseUrl) {
    return path.startsWith('/') ? path : `/${path}`;
  }

  // clean up trailing slash from baseUrl to avoid double slashes
  const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return path.startsWith('/') ? `${cleanBaseUrl}${path}` : `${cleanBaseUrl}/${path}`;
};

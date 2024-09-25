import { setCookie } from 'cookies-next';

import { reportAuthCookieName, serveReportRoute } from '@/app/lib/constants';

export const setReportAuthCookie = (apiToken: string) => {
  if (!apiToken) {
    return;
  }

  const cookieAgeSeconds = 10 * 60; // 10 minutes

  setCookie(reportAuthCookieName, apiToken, {
    maxAge: cookieAgeSeconds,
    path: serveReportRoute,
    secure: true,
    sameSite: 'strict',
  });
};

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { setCookie } from 'cookies-next';
import { Spinner } from '@nextui-org/react';
import { useEffect } from 'react';

import { title } from '@/app/components/primitives';
import { useApiToken } from '@/app/providers/ApiTokenProvider';
import { reportAuthCookieName, serveReportRoute } from '@/app/lib/constants';

export default function VerifyAuth() {
  const searchParams = useSearchParams();
  const { apiToken, isClientAuthorized } = useApiToken();
  const router = useRouter();

  useEffect(() => {
    if (isClientAuthorized()) {
      const url = searchParams.get('callbackUrl') ?? '';

      if (url && apiToken) {
        const cookieAgeSeconds = 10 * 60; // 10 minutes

        setCookie(reportAuthCookieName, apiToken, {
          maxAge: cookieAgeSeconds,
          path: serveReportRoute,
          secure: true,
          sameSite: 'strict',
        });
        router.replace(url);
      }
    }
  }, [apiToken]);

  return (
    <div>
      <h1 className={title()}>
        Checking API Token <Spinner />
      </h1>
    </div>
  );
}

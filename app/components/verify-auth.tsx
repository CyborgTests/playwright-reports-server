'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { setCookie } from 'cookies-next';
import { Spinner } from '@nextui-org/react';
import { useEffect, useState } from 'react';

import { title } from '@/app/components/primitives';
import { getExistingToken } from '@/app/config/auth';
import { useApiToken } from '@/app/providers/ApiTokenProvider';
import { reportAuthCookieName, serveReportRoute } from '@/app/lib/constants';

export default function VerifyAuth() {
  const [hash, setHash] = useState('');
  const searchParams = useSearchParams();
  const { apiToken, expirationHours } = useApiToken();
  const router = useRouter();

  useEffect(() => {
    if (!apiToken) {
      return;
    }

    const hash = getExistingToken(expirationHours);

    setHash(hash);
  }, [apiToken]);

  const url = searchParams.get('callbackUrl') ?? '';

  if (url && apiToken && hash) {
    const cookieAgeSeconds = 10 * 60; // 10 minutes

    setCookie(reportAuthCookieName, apiToken, {
      maxAge: cookieAgeSeconds,
      path: serveReportRoute,
      secure: true,
      sameSite: 'strict',
    });
    router.replace(url);
  }

  return (
    <div>
      <h1 className={title()}>
        Checking API Token <Spinner />
      </h1>
    </div>
  );
}

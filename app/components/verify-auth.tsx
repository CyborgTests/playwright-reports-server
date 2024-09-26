'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Spinner } from '@nextui-org/react';
import { useEffect } from 'react';

import { title } from '@/app/components/primitives';
import { useApiToken } from '@/app/providers/ApiTokenProvider';
import { setReportAuthCookie } from '@/app/config/cookie';

export default function VerifyAuth() {
  const searchParams = useSearchParams();
  const { apiToken, isClientAuthorized } = useApiToken();
  const router = useRouter();

  useEffect(() => {
    if (isClientAuthorized()) {
      const url = searchParams.get('callbackUrl') ?? '';

      if (url && apiToken) {
        setReportAuthCookie(apiToken);
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

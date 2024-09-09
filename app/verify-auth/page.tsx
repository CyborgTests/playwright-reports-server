import { Suspense } from 'react';

import VerifyAuth from '@/app/components/verify-auth';

export default async function VerifyAuthPageWithSearchParams() {
  return (
    // useSearchParams() used in verify auth page should be wrapped in a suspense boundary
    <Suspense fallback="Loading...">
      <VerifyAuth />
    </Suspense>
  );
}

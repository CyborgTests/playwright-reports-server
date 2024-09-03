import type { NextRequest } from 'next/server';

import { CommonResponseFactory } from '@/app/lib/response';
import { isAuthorized } from '@/app/lib/auth';
import { env } from '@/app/config/env';

export const config = {
  // match all api routes except /api/serve/
  // we do not have auth header when opening static files
  matcher: '/api((?!/serve/).*)',
};

export function middleware(request: NextRequest) {
  if (env.API_TOKEN && !request.url.endsWith('/ping')) {
    return returnUnauthorizedResponseIfTokenDoesNotMatch(request, env.API_TOKEN);
  }
}

function returnUnauthorizedResponseIfTokenDoesNotMatch(request: NextRequest, apiToken: string) {
  const actualAuthToken = request.headers.get('Authorization');
  const expectedAuthToken = apiToken;

  if (!isAuthorized({ actualAuthToken, expectedAuthToken })) {
    return CommonResponseFactory.buildUnauthorizedResponse();
  }
}

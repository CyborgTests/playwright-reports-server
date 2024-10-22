import { NextResponse, type NextRequest } from 'next/server';

import { CommonResponseFactory } from '@/app/lib/network';
import { isAuthorized } from '@/app/lib/auth';
import { env } from '@/app/config/env';

export const config = {
  matcher: '/api/:path*',
};

export async function middleware(request: NextRequest) {
  const isAuthRequired = !!env.API_TOKEN;

  if (!isAuthRequired) {
    return NextResponse.next();
  }

  const unprotectedRoutes = ['/api/ping', '/api/auth/', '/api/serve/', '/api/static/'];

  const isUnprotected = unprotectedRoutes.some((route) => request.nextUrl.pathname.startsWith(route));

  if (isUnprotected) {
    return NextResponse.next();
  }

  return returnUnauthorizedResponseIfTokenDoesNotMatch(request, env.API_TOKEN!);
}

function returnUnauthorizedResponseIfTokenDoesNotMatch(request: NextRequest, apiToken: string) {
  const actualAuthToken = request.headers.get('Authorization');
  const expectedAuthToken = apiToken;

  if (!isAuthorized({ actualAuthToken, expectedAuthToken })) {
    return CommonResponseFactory.buildUnauthorizedResponse();
  }
}

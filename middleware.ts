import { NextResponse, type NextRequest } from 'next/server';

import { CommonResponseFactory } from '@/app/lib/network';
import { isAuthorized } from '@/app/lib/auth';
import { env } from '@/app/config/env';
import { withBase } from '@/app/lib/url';

export const config = {
  matcher: '/api/:path*',
};

export async function middleware(request: NextRequest) {
  const isAuthRequired = !!env.API_TOKEN;

  if (!isAuthRequired) {
    return NextResponse.next();
  }

  const routes = [
    {
      methods: ['GET'],
      path: '/api/ping',
    },
    {
      methods: ['GET', 'POST'],
      path: '/api/auth/',
    },
    {
      methods: ['GET'],
      path: '/api/serve/',
    },
    {
      methods: ['GET'],
      path: '/api/static/',
    },
    {
      methods: ['GET'],
      path: '/api/config/',
    },
  ];
  const unprotectedRoutes = routes.concat(
    routes.map((route) => {
      return { methods: route.methods, path: withBase(route.path) };
    }),
  );

  const isUnprotected = unprotectedRoutes.some(
    (route) =>
      request.nextUrl.pathname.startsWith(route.path) && route.methods.some((method) => method === request.method),
  );

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

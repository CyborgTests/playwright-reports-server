import { NextResponse, type NextRequest } from 'next/server';

import { CommonResponseFactory } from '@/app/lib/response';
import { isAuthorized } from '@/app/lib/auth';
import { env } from '@/app/config/env';
import { serveReportRoute } from '@/app/lib/constants';

export const config = {
  matcher: '/api/:path*',
};

export function middleware(request: NextRequest) {
  const isCookieAuth = request.url.includes(serveReportRoute);
  const isHeaderAuth = !request.url.endsWith('/ping');

  if (env.API_TOKEN && isCookieAuth) {
    return handleCookieAuth(request, env.API_TOKEN);
  }

  if (env.API_TOKEN && isHeaderAuth) {
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

function handleCookieAuth(request: NextRequest, apiToken: string) {
  const actualAuthToken = request.cookies.get('auth')?.value ?? '';
  const expectedAuthToken = apiToken;

  if (!isAuthorized({ actualAuthToken, expectedAuthToken })) {
    /**
     * You are not able to just redirect a user back to the host
     * https://github.com/vercel/next.js/issues/37536#issuecomment-1160548793
     * Next.js hide real host for security reasons
     * when deployed outside of vercel (surprise-surprise)
     */
    const realHost = request.headers.get('host');
    const internalHost = '0.0.0.0:3000';

    const url = `${request.nextUrl.protocol}//${internalHost}/verify-auth?callbackUrl=${request.url}`;

    const verifyAuthUrl = realHost ? url.replaceAll(internalHost, realHost) : url;

    return NextResponse.redirect(verifyAuthUrl);
  }
}

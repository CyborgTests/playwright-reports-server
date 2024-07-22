import type { NextRequest } from 'next/server';
import { CommonResponseFactory } from './app/lib/response';
import { isAuthorized } from './app/lib/auth';
import { env } from './app/config/env';

export function middleware(request: NextRequest) {
  const actualAuthToken = request.headers.get('Authorization');
  const expectedAuthToken = env.API_TOKEN;

  if (!isAuthorized({ actualAuthToken, expectedAuthToken })) {
    return CommonResponseFactory.buildUnauthorizedResponse();
  }
}

import type { NextRequest } from 'next/server';
import { CommonResponseFactory } from './app/api/shared/response';
import { isAuthorized } from './app/api/shared/auth';
import { env } from './app/config/env';

export function middleware(request: NextRequest) {
  console.warn('middleware is running');
  const actualAuthToken = request.headers.get('Authorization');
  const expectedAuthToken = env.API_TOKEN;

  if (!isAuthorized({ actualAuthToken, expectedAuthToken })) {
    return CommonResponseFactory.buildUnauthorizedResponse();
  }
}

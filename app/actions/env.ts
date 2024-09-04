'use server';

import { env } from '@/app/config/env';

export async function getApiTokenFromEnv() {
  return env.API_TOKEN;
}

'use server';

import { env } from '@/app/config/env';

export async function getEnvVariables() {
  return {
    token: env.API_TOKEN,
    expirationHours: env.UI_AUTH_EXPIRE_HOURS,
  };
}

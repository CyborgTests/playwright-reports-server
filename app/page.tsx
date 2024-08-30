import { redirect } from 'next/navigation';

import { env } from '@/app/config/env';

export default async function RootPage() {
  const apiTokenRequired = !!env.API_TOKEN;

  redirect(apiTokenRequired ? '/login' : '/home');
}

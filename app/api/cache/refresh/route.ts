import { revalidatePath } from 'next/cache';

import { withError } from '@/app/lib/withError';
import { forceInitDatabase } from '@/app/lib/service/db';
import { env } from '@/app/config/env';
import { configCache } from '@/app/lib/service/cache/config';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function POST(_: Request) {
  if (!env.USE_SERVER_CACHE) {
    return Response.json({ error: 'USE_SERVER_CACHE is disabled' }, { status: 403 });
  }

  configCache.initialized = false;
  const { error } = await withError(Promise.all([configCache.init(), forceInitDatabase()]));

  revalidatePath('/');

  if (error) {
    return Response.json({ error: error?.message }, { status: 500 });
  }

  return Response.json({ success: true });
}

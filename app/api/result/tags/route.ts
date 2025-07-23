import { NextRequest } from 'next/server';

import { withError } from '@/app/lib/withError';
import { service } from '@/app/lib/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const project = searchParams.get('project') ?? '';

  const { result: tags, error } = await withError(service.getResultsTags(project));

  if (error) {
    return new Response(error.message, { status: 400 });
  }

  return Response.json(tags);
}

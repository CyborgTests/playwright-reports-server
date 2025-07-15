import { type NextRequest } from 'next/server';

import { service } from '@/app/lib/service';
import { withError } from '@/app/lib/withError';
import { parseFromRequest } from '@/app/lib/storage/pagination';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const pagination = parseFromRequest(searchParams);
  const project = searchParams.get('project') ?? '';
  const tags = searchParams.get('tags')?.split(',').filter(Boolean) ?? [];
  const search = searchParams.get('search') ?? '';

  const { result, error } = await withError(service.getResults({ pagination, project, tags, search }));

  if (error) {
    return new Response(error.message, { status: 400 });
  }

  return Response.json(result);
}

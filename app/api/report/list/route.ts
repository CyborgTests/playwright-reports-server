import { type NextRequest } from 'next/server';

import { withError } from '@/app/lib/withError';
import { parseFromRequest } from '@/app/lib/storage/pagination';
import { service } from '@/app/lib/service';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const pagination = parseFromRequest(searchParams);
  const project = searchParams.get('project') ?? '';
  const search = searchParams.get('search') ?? '';

  const { result: reports, error } = await withError(service.getReports({ pagination, project, search }));

  if (error) {
    return new Response(error.message, { status: 400 });
  }

  return Response.json(reports!);
}

import { type NextRequest } from 'next/server';

import { service } from '@/app/lib/service';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const project = searchParams.get('project') ?? '';
  const { reports } = await service.getReports({ project });

  const latestReports = reports.slice(0, 20);

  return Response.json(latestReports);
}

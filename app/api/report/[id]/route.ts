import { type NextRequest } from 'next/server';

import { withError } from '@/app/lib/withError';
import { reportService } from '@/app/lib/service';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function GET(
  req: NextRequest,
  {
    params,
  }: {
    params: {
      id: string;
    };
  },
) {
  const { id } = params;

  if (!id) {
    return new Response('report ID is required', { status: 400 });
  }

  const { result: report, error } = await withError(reportService.getReport(id));

  if (error) {
    return new Response(`failed to get report: ${error?.message ?? 'unknown error'}`, { status: 400 });
  }

  return Response.json(report);
}

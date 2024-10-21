import path from 'node:path';

import { type NextRequest } from 'next/server';

import { storage } from '@/app/lib/storage';
import { parse } from '@/app/lib/parser';
import { withError } from '@/app/lib/withError';

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

  const { result: stats, error: statsError } = await withError(storage.readReports({ ids: [id] }));

  if (statsError || !stats) {
    return new Response(`failed to read reports: ${statsError?.message ?? 'unknown error'}`, { status: 500 });
  }

  const reportStats = stats.reports.find((r) => r.reportID === id);

  const { result: html, error } = await withError(
    storage.readFile(path.join(reportStats?.project ?? '', id, 'index.html'), 'text/html'),
  );

  if (error || !html) {
    return new Response(`failed to read report html file: ${error?.message ?? 'unknown error'}`, { status: 404 });
  }

  const { result: info, error: parseError } = await withError(parse(html as string));

  if (parseError || !info) {
    return new Response(`failed to parse report html file: ${parseError?.message ?? 'unknown error'}`, { status: 400 });
  }

  return Response.json({
    ...info,
    ...reportStats,
  });
}

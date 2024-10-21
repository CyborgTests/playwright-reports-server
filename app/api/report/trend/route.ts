import path from 'node:path';

import { type NextRequest } from 'next/server';

import { storage } from '@/app/lib/storage';
import { parse } from '@/app/lib/parser';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const project = searchParams.get('project') ?? '';
  const { reports } = await storage.readReports({ project });

  const latestReports = reports.slice(0, 20);

  const latestReportsInfo = await Promise.all(
    latestReports.map(async (report) => {
      const html = await storage.readFile(path.join(report.project ?? '', report.reportID, 'index.html'), 'text/html');
      const info = await parse(html as string);

      return {
        ...report,
        ...info,
      };
    }),
  );

  return Response.json(latestReportsInfo);
}

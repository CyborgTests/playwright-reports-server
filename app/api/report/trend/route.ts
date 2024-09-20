import path from 'node:path';

import { storage } from '@/app/lib/storage';
import { parse } from '@/app/lib/parser';
import { sortReportsByCreatedDate } from '@/app/lib/sort';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function GET() {
  const reports = await storage.readReports();

  const latestReports = sortReportsByCreatedDate(reports).slice(0, 20);

  const latestReportsInfo = await Promise.all(
    latestReports.map(async (report) => {
      const html = await storage.readFile(path.join(report.reportID, 'index.html'), 'text/html');
      const info = await parse(html as string);

      return {
        ...report,
        ...info,
      };
    }),
  );

  return Response.json(latestReportsInfo);
}

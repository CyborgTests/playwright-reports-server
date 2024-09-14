import path from 'node:path';

import { readFile, readReports } from '@/app/lib/data';
import { parse } from '@/app/lib/parser';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function GET() {
  const reports = await readReports();

  const latestReports = reports.slice(0, 20);

  const latestReportsInfo = await Promise.all(
    latestReports.map(async (report) => {
      const html = await readFile(path.join(report.reportID, 'index.html'), 'text/html');
      const info = await parse(html as string);

      return {
        ...report,
        ...info,
      };
    }),
  );

  return Response.json(latestReportsInfo);
}

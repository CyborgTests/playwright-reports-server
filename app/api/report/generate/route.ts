import { generateReport } from '@/app/lib/data';

export const dynamic = 'force-dynamic'; // defaults to auto
export async function POST(request: Request) {
  const reqBody = await request.json();
  const reportId = await generateReport(reqBody.resultsIds);
  return Response.json({ 
    reportId,
    reportUrl: `/data/reports/${reportId}/index.html` 
  });
}

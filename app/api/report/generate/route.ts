import { serveReportRoute } from '@/app/lib/constants';
import { reportService } from '@/app/lib/service';
import { withError } from '@/app/lib/withError';

export const dynamic = 'force-dynamic'; // defaults to auto
export async function POST(request: Request) {
  const { result: reqBody, error: reqError } = await withError(request.json());

  const { resultsIds, project } = reqBody;

  if (reqError) {
    return new Response(reqError.message, { status: 400 });
  }

  const { result: reportId, error } = await withError(reportService.generateReport(resultsIds, project));

  if (error) {
    return new Response(error.message, { status: 404 });
  }

  return Response.json({
    reportId,
    project,
    reportUrl: `${serveReportRoute}/${project ? encodeURI(project) : ''}/${reportId}/index.html`,
  });
}

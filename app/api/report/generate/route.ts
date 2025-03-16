import { service } from '@/app/lib/service';
import { withError } from '@/app/lib/withError';

export const dynamic = 'force-dynamic'; // defaults to auto
export async function POST(request: Request) {
  const { result: reqBody, error: reqError } = await withError(request.json());

  const { resultsIds, project, ...rest } = reqBody;

  if (reqError) {
    return new Response(reqError.message, { status: 400 });
  }

  const { result, error } = await withError(service.generateReport(resultsIds, { project, ...rest }));

  if (error) {
    console.error(error);

    return new Response(error.message, { status: 404 });
  }

  if (!result?.reportId) {
    return new Response('failed to generate report', { status: 400 });
  }

  return Response.json(result);
}

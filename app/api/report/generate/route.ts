import { service } from '@/app/lib/service';
import { withError } from '@/app/lib/withError';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function POST(request: Request) {
  const { result: reqBody, error: reqError } = await withError(request.json());

  const { resultsIds, project, playwrightVersion, ...rest } = reqBody;

  if (reqError) {
    return new Response(reqError.message, { status: 400 });
  }

  try {
    const result = await service.generateReport(resultsIds, { project, playwrightVersion, ...rest });

    if (!result?.reportId) {
      return new Response('failed to generate report', { status: 400 });
    }

    return Response.json(result);
  } catch (error) {
    return new Response(error as any, { status: 500 });
  }
}

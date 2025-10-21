import { service } from '@/app/lib/service';
import { withError } from '@/app/lib/withError';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function POST(request: Request) {
  const { result: reqBody, error: reqError } = await withError(request.json());

  if (reqError) {
    return new Response(reqError.message, { status: 400 });
  }
  const { resultsIds, project, playwrightVersion, ...rest } = reqBody;

  try {
    const result = await service.generateReport(resultsIds, { project, playwrightVersion, ...rest });

    if (!result?.reportId) {
      return new Response('failed to generate report', { status: 400 });
    }

    return Response.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('ENOENT: no such file or directory')) {
      return new Response(`Result not found: ${error.message}`, { status: 404 });
    }

    return new Response(error as any, { status: 500 });
  }
}

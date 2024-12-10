import { service } from '@/app/lib/service';
import { withError } from '@/app/lib/withError';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function GET() {
  const { result: projects, error } = await withError(service.getResultsProjects());

  if (error) {
    return new Response(error.message, { status: 400 });
  }

  return Response.json(projects);
}

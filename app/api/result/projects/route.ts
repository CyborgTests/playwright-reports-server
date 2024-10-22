import { storage } from '@/app/lib/storage';
import { withError } from '@/app/lib/withError';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function GET() {
  const { result: projects, error } = await withError(storage.getResultsProjects());

  if (error) {
    return new Response(error.message, { status: 400 });
  }

  return Response.json(projects);
}

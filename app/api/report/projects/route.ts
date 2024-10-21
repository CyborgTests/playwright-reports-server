import { storage } from '@/app/lib/storage';
import { withError } from '@/app/lib/withError';

export async function GET() {
  const { result: projects, error } = await withError(storage.getReportsProjects());

  if (error) {
    return new Response(error.message, { status: 400 });
  }

  return Response.json(projects);
}

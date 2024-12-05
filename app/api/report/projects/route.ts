import { reportService } from '@/app/lib/service';
import { withError } from '@/app/lib/withError';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function GET() {
  const { result: projects, error } = await withError(reportService.getReportsProjects());

  if (error) {
    return new Response(error.message, { status: 400 });
  }

  return Response.json(projects);
}

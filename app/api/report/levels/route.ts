import { service } from '@/app/lib/service';
import { withError } from '@/app/lib/withError';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function GET() {
  const { result: levels, error } = await withError(service.getReportsLevels());

  if (error) {
    return new Response(error.message, { status: 400 });
  }

  return Response.json(levels);
}

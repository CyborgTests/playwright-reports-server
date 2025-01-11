import { service } from '@/app/lib/service';
import { withError } from '@/app/lib/withError';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function GET() {
  const { result, error } = await withError(service.getServerInfo());

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(result);
}

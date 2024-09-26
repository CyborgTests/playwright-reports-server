import { storage } from '@/app/lib/storage';
import { withError } from '@/app/lib/withError';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function GET() {
  const { result: results, error } = await withError(storage.readResults());

  if (error) {
    return new Response(error.message, { status: 400 });
  }

  return Response.json(results?.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
}

import { storage } from '@/app/lib/storage';
import { withError } from '@/app/lib/withError';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function GET() {
  const { result: reports, error } = await withError(storage.readReports());

  if (error) {
    return new Response(error.message, { status: 400 });
  }

  return Response.json(reports?.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
}

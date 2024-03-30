import { readResults } from '@/app/lib/data';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function GET() {
  const results = readResults();

  return Response.json({ results });
}

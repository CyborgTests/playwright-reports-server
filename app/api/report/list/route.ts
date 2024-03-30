import { readReports } from '@/app/lib/data';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function GET() {
  const reports = await readReports();

  return Response.json({ reports });
}

import { getServerDataInfo } from '@/app/lib/data';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function GET() {
  return Response.json(
    await getServerDataInfo(),
  );
}

import { deleteResults } from '@/app/lib/data';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function DELETE(request: Request) {
  const reqData = await request.json();
  reqData.resultsIds;
  try {
    await deleteResults(reqData.resultsIds);
    return Response.json({
      message: `Results files deleted successfully`,
      resultsIds: reqData.resultsIds,
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 404 });
  }
}

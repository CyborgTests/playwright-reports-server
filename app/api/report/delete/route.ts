import { deleteReports } from '@/app/lib/data';

export const dynamic = 'force-dynamic'; // defaults to auto
export async function DELETE(request: Request) {
  const reqData = await request.json();

  try {
    await deleteReports(reqData.reportsIds);
    return Response.json({
      message: `Reports deleted successfully`,
      reportsIds: reqData.reportsIds,
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 404 });
  }
}

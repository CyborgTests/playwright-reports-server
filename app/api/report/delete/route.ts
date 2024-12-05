import { reportService } from '@/app/lib/service';
import { withError } from '@/app/lib/withError';

export const dynamic = 'force-dynamic'; // defaults to auto
export async function DELETE(request: Request) {
  const { result: reqData, error: reqError } = await withError(request.json());

  if (reqError) {
    return new Response(reqError.message, { status: 400 });
  }

  const { error } = await withError(reportService.deleteReports(reqData.reportsIds));

  if (error) {
    return new Response(error.message, { status: 404 });
  }

  return Response.json({
    message: `Reports deleted successfully`,
    reportsIds: reqData.reportsIds,
  });
}

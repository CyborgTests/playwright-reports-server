import { saveResult } from '@/app/lib/data';

export const dynamic = 'force-dynamic'; // defaults to auto
export async function PUT(request: Request) {
  try {
    const formData = await request.formData();

    const file = formData.get('file') as File;
    // TODO: here is place to define additional fields
    const name = formData.get('name');
    if (!file) {
      return Response.json({ error: 'No files received.' }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const metaData = await saveResult(buffer);
    return Response.json({
      message: 'Success',
      data: metaData,
      status: 201,
    });
  } catch (error) {
    return Response.json({
      message: 'Failed',
      data: {
        error: (error as Error).message,
      },
      status: 500,
    });
  }
}

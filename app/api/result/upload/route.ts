import { saveResult } from '@/app/lib/data';

export const dynamic = 'force-dynamic'; // defaults to auto
export async function PUT(request: Request) {
  try {
    const formData = await request.formData();
    if (!formData.has('file')) {
      return Response.json({ error: 'Field "file" with result is missing' }, { status: 400 });
    }
    const file = formData.get('file') as File;
    const buffer = Buffer.from(await file.arrayBuffer()); 
    const resultDetails: { [key: string]: string } = {};
    for (const [key, value] of formData.entries()) {
      if (key === 'file') {
        // already processed
        continue;
      }
      // String values for now
      resultDetails[key] = value.toString();
    }
    const savedResult = await saveResult(buffer, resultDetails);
    return Response.json({
      message: 'Success',
      data: savedResult,
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

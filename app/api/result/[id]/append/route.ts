import { withError } from '@/app/lib/withError';
import { service } from '@/app/lib/service';

export const dynamic = 'force-dynamic'; // defaults to auto

export async function PUT(
  request: Request,
  {
    params,
  }: {
    params: {
      id: string;
    };
  },
) {
  const { id } = params;

  if (!id) {
    return new Response('report ID is required', { status: 400 });
  }

  const { result: formData, error: formParseError } = await withError(request.formData());

  if (formParseError) {
    return Response.json({ error: formParseError.message }, { status: 400 });
  }

  if (!formData) {
    return Response.json({ error: 'Form data is missing' }, { status: 400 });
  }

  if (!formData.has('part')) {
    return Response.json({ error: 'Field "part" with result is missing' }, { status: 400 });
  }

  if (!formData.has('chunkIndex')) {
    return Response.json({ error: 'Field "chunkIndex" with result is missing' }, { status: 400 });
  }

  if (!formData.has('totalChunks')) {
    return Response.json({ error: 'Field "totalChunks" with result is missing' }, { status: 400 });
  }

  const part = formData.get('part') as Blob;

  const { error } = await withError(
    service.saveResultPartially(
      id,
      {
        part,
        chunkIndex: Number(formData.get('chunkIndex')),
        totalChunks: Number(formData.get('totalChunks')),
      },
      request.headers,
    ),
  );

  if (error) {
    return Response.json({ error: `failed to save result part: ${error.message}` }, { status: 500 });
  }

  return Response.json({
    message: 'Success',
    status: 201,
  });
}

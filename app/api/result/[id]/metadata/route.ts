import { type ResultDetails } from '@/app/lib/storage';
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

  const resultDetails: ResultDetails = {};

  for (const [key, value] of formData.entries()) {
    if (key === 'file') {
      // already processed
      continue;
    }
    resultDetails[key] = value.toString();
  }

  const { result: savedResult, error } = await withError(service.saveResultMetadata(id, resultDetails));

  if (error) {
    return Response.json({ error: `failed to save result metadata: ${error.message}` }, { status: 500 });
  }

  return Response.json({
    message: 'Success',
    data: savedResult,
    status: 201,
  });
}

import { isBufferZipResult } from '@/app/lib/parser/validate';
import { type ResultDetails } from '@/app/lib/storage';
import { withError } from '@/app/lib/withError';
import { service } from '@/app/lib/service';

export const dynamic = 'force-dynamic'; // defaults to auto
export async function PUT(request: Request) {
  const { result: formData, error: formParseError } = await withError(request.formData());

  if (formParseError) {
    return Response.json({ error: formParseError.message }, { status: 400 });
  }

  if (!formData) {
    return Response.json({ error: 'Form data is missing' }, { status: 400 });
  }

  if (!formData.has('file')) {
    return Response.json({ error: 'Field "file" with result is missing' }, { status: 400 });
  }

  const file = formData.get('file') as File;

  const { result: arrayBuffer, error: arrayBufferError } = await withError(file.arrayBuffer());

  if (arrayBufferError) {
    return Response.json({ error: `failed to get array buffer: ${arrayBufferError.message}` }, { status: 400 });
  }

  const buffer = Buffer.from(arrayBuffer!);
  const resultDetails: ResultDetails = {};

  for (const [key, value] of formData.entries()) {
    if (key === 'file') {
      // already processed
      continue;
    }
    // String values for now
    resultDetails[key] = value.toString();
  }

  const { error: bufferValidationError } = await withError(isBufferZipResult(buffer));

  if (bufferValidationError) {
    return Response.json({ error: `invalid result file: ${bufferValidationError.message}` }, { status: 400 });
  }

  const { result: savedResult, error } = await withError(service.saveResult(buffer, resultDetails));

  if (error) {
    return Response.json({ error: `failed to save results: ${error.message}` }, { status: 500 });
  }

  return Response.json({
    message: 'Success',
    data: savedResult,
    status: 201,
  });
}

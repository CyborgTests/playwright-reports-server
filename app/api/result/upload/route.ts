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

  const file = formData.get('file') as Blob;

  const resultDetails: ResultDetails = {};

  for (const [key, value] of formData.entries()) {
    if (key === 'file') {
      // already processed
      continue;
    }
    // String values for now
    resultDetails[key] = value.toString();
  }

  const { result: savedResult, error } = await withError(service.saveResult(file, file.size, resultDetails));

  if (error) {
    return Response.json({ error: `failed to save results: ${error.message}` }, { status: 500 });
  }

  let generatedReport = null;

  if (resultDetails.shardCurrent && resultDetails.shardTotal && resultDetails.triggerReportGeneration === 'true') {
    const { result: results, error: resultsError } = await withError(
      service.getResults({
        testRun: resultDetails.testRun,
      }),
    );

    if (resultsError) {
      return Response.json({ error: `failed to generate report: ${resultsError.message}` }, { status: 500 });
    }

    // Checking if all shards are uploaded
    if (results?.results.length === parseInt(resultDetails.shardTotal)) {
      const ids = results.results.map((result) => result.resultID);

      console.log('triggerReportGeneration for', resultDetails.testRun, ids);
      const { result, error } = await withError(
        service.generateReport(ids, {
          project: resultDetails.project,
          testRun: resultDetails.testRun,
        }),
      );

      if (error) {
        return Response.json({ error: `failed to generate report: ${error.message}` }, { status: 500 });
      }

      generatedReport = result;
    }
  }

  return Response.json({
    message: 'Success',
    data: { ...savedResult, generatedReport },
    status: 201,
  });
}

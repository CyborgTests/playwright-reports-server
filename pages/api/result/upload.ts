import type { NextApiRequest, NextApiResponse } from 'next';

import { pipeline } from 'node:stream/promises';
import { PassThrough } from 'node:stream';

import Busboy from 'busboy';

import { service } from '@/app/lib/service';
import { DEFAULT_STREAM_CHUNK_SIZE } from '@/app/lib/storage/constants';
import { withError } from '@/app/lib/withError';

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    res.setHeader('Allow', 'PUT');

    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const resultDetails: Record<string, string> = {};
  let fileSize = 0;

  const filePassThrough = new PassThrough({
    highWaterMark: DEFAULT_STREAM_CHUNK_SIZE,
  });

  const bb = Busboy({
    headers: req.headers,
    limits: {
      files: 1,
    },
    highWaterMark: DEFAULT_STREAM_CHUNK_SIZE,
    fileHwm: DEFAULT_STREAM_CHUNK_SIZE,
  });

  let saveResultPromise: Promise<string> | Promise<void>;

  const uploadPromise = new Promise<string>((resolve, reject) => {
    let fileReceived = false;

    bb.on('file', (_, fileStream) => {
      fileReceived = true;

      saveResultPromise = service
        .saveResult(filePassThrough)
        .then((result) => {
          resolve(result);
        })
        .catch((error: Error) => {
          reject(error);
        });

      fileStream.on('data', (chunk) => {
        fileSize += chunk.length;

        const canContinue = filePassThrough.write(chunk);

        if (!canContinue) {
          fileStream.pause();
          filePassThrough.once('drain', () => {
            fileStream.resume();
          });
        }
      });

      fileStream.on('end', () => {
        filePassThrough.end();
      });

      fileStream.on('error', (error) => {
        filePassThrough.destroy(error);
        reject(error);
      });
    });

    bb.on('field', (name, val) => {
      resultDetails[name] = val;
    });

    bb.on('error', (error: Error) => {
      reject(error);
    });

    bb.on('finish', async () => {
      if (!fileReceived) {
        reject(new Error('No file received'));

        return;
      }

      if (saveResultPromise) {
        try {
          await saveResultPromise;
        } catch (error) {
          reject(error as Error);
        }
      }
    });
  });

  const { error: streamPipelineError } = await withError(pipeline(req, bb));

  if (streamPipelineError) {
    console.error('Error processing request:', streamPipelineError);

    return;
  }

  const { result: resultID, error: uploadError } = await withError(uploadPromise);

  if (uploadError) {
    if (!filePassThrough.destroyed) {
      filePassThrough.destroy();
    }

    res.status(400).json({ error: `upload result failed: ${uploadError.message}` });

    return;
  }

  const { result: uploadResult, error: uploadResultDetailsError } = await withError(
    service.saveResultDetails(resultID!, resultDetails, fileSize),
  );

  if (uploadResultDetailsError) {
    res.status(400).json({ error: `upload result details failed: ${uploadResultDetailsError.message}` });
    await service.deleteResults([resultID!]);

    return;
  }

  let generatedReport = null;

  if (resultDetails.shardCurrent && resultDetails.shardTotal && resultDetails.triggerReportGeneration === 'true') {
    const { result: results, error: resultsError } = await withError(
      service.getResults({
        testRun: resultDetails.testRun,
      }),
    );

    if (resultsError) {
      return res.status(500).json({ error: `failed to generate report: ${resultsError.message}` });
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

  return res.status(200).json({
    message: 'Success',
    data: { ...uploadResult, generatedReport },
  });
}

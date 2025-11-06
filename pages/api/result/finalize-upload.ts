import type { NextApiRequest, NextApiResponse } from 'next';

import { randomUUID } from 'node:crypto';
import { readdir, unlink, rmdir, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { PassThrough } from 'node:stream';

import { service } from '@/app/lib/service';
import { TMP_FOLDER, DEFAULT_STREAM_CHUNK_SIZE } from '@/app/lib/storage/constants';
import { withError } from '@/app/lib/withError';

export const config = { api: { bodyParser: true } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log('[finalize-upload] Handler started');
  console.log('[finalize-upload] Request method:', req.method);
  console.log('[finalize-upload] Request body keys:', req.body ? Object.keys(req.body) : 'no body');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { uploadId, resultDetails: rawResultDetails } = req.body;

  console.log('[finalize-upload] uploadId:', uploadId);
  console.log('[finalize-upload] rawResultDetails:', rawResultDetails);

  if (!uploadId) {
    console.error('[finalize-upload] Missing uploadId');

    return res.status(400).json({ error: 'Missing uploadId' });
  }

  // Ensure resultDetails is properly formatted as Record<string, string>
  const resultDetails: Record<string, string> =
    rawResultDetails && typeof rawResultDetails === 'object'
      ? Object.fromEntries(Object.entries(rawResultDetails).map(([k, v]) => [k, String(v ?? '')]))
      : {};

  console.log('[finalize-upload] Parsed resultDetails:', resultDetails);

  const chunksDir = join(TMP_FOLDER, 'chunks', uploadId);

  console.log('[finalize-upload] Looking for chunks in:', chunksDir);
  let chunks: string[];

  try {
    chunks = await readdir(chunksDir);
    console.log('[finalize-upload] Found chunks:', chunks.length, chunks.slice(0, 5));
  } catch (error) {
    console.error('[finalize-upload] Error reading chunks directory:', error);

    return res.status(404).json({ error: 'Upload not found or already finalized' });
  }

  chunks.sort((a, b) => {
    const aIndex = parseInt(a.split('-')[1], 10);
    const bIndex = parseInt(b.split('-')[1], 10);

    return aIndex - bIndex;
  });

  const resultID = randomUUID();
  const fileName = `${resultID}.zip`;

  console.log('[finalize-upload] Generated resultID:', resultID);
  console.log('[finalize-upload] File name:', fileName);

  const mergedFilePath = join(TMP_FOLDER, fileName);

  console.log('[finalize-upload] Merged file path:', mergedFilePath);

  const writeStream = createWriteStream(mergedFilePath, {
    highWaterMark: DEFAULT_STREAM_CHUNK_SIZE,
  });

  // Increase max listeners to handle multiple chunks and pipeline operations
  // Each pipeline adds listeners, so we need a higher limit
  writeStream.setMaxListeners(Math.max(chunks.length * 2, 500));
  console.log('[finalize-upload] Starting to merge', chunks.length, 'chunks');

  try {
    // Stream chunks sequentially to avoid loading all into memory
    for (let i = 0; i < chunks.length; i++) {
      const chunkName = chunks[i];
      const chunkPath = join(chunksDir, chunkName);

      console.log(`[finalize-upload] Merging chunk ${i + 1}/${chunks.length}: ${chunkName}`);

      const chunkReadStream = createReadStream(chunkPath, {
        highWaterMark: DEFAULT_STREAM_CHUNK_SIZE,
      });

      const { error: mergeError } = await withError(pipeline(chunkReadStream, writeStream, { end: false }));

      if (mergeError) {
        console.error(`[finalize-upload] Error merging chunk ${chunkName}:`, mergeError);
        writeStream.destroy();

        return res.status(500).json({ error: `Failed to merge chunk ${chunkName}: ${mergeError.message}` });
      }
      console.log(`[finalize-upload] Successfully merged chunk ${i + 1}/${chunks.length}`);
    }

    console.log('[finalize-upload] All chunks merged, ending write stream');
    writeStream.end();

    const { error: finishError } = await withError(
      new Promise<void>((resolve, reject) => {
        const onFinish = () => {
          writeStream.removeListener('error', onError);
          resolve();
        };
        const onError = (error: Error) => {
          writeStream.removeListener('finish', onFinish);
          reject(error);
        };

        writeStream.once('finish', onFinish);
        writeStream.once('error', onError);
      }),
    );

    if (finishError) {
      console.error('[finalize-upload] Error finalizing merged file:', finishError);

      return res.status(500).json({ error: `Failed to finalize merged file: ${finishError.message}` });
    }
    console.log('[finalize-upload] Write stream finished successfully');
  } catch (error) {
    console.error('[finalize-upload] Exception during chunk merging:', error);
    writeStream.destroy();
    const errorMessage = error instanceof Error ? error.message : String(error);

    return res.status(500).json({ error: `Failed to merge chunks: ${errorMessage}` });
  }

  // Get total size from the merged file
  console.log('[finalize-upload] Getting file size for:', mergedFilePath);
  const { result: fileStat, error: statError } = await withError(stat(mergedFilePath));

  if (statError || !fileStat) {
    console.error('[finalize-upload] Error getting file stat:', statError);

    return res.status(500).json({ error: `Failed to get file size: ${statError?.message || 'Unknown error'}` });
  }

  const totalSize = fileStat.size;

  console.log('[finalize-upload] Merged file size:', totalSize, 'bytes');

  console.log('[finalize-upload] Getting presigned URL for:', fileName);
  const presignedUrl = await service.getPresignedUrl(fileName);

  console.log('[finalize-upload] Presigned URL:', presignedUrl ? 'received' : 'not received');
  const contentLength = totalSize.toString();

  console.log('[finalize-upload] Creating PassThrough stream');
  const filePassThrough = new PassThrough({
    highWaterMark: DEFAULT_STREAM_CHUNK_SIZE,
  });

  console.log('[finalize-upload] Starting service.saveResult (consumer) first...');
  // Start saveResult first so it can consume the stream
  const saveResultPromise = service.saveResult(fileName, filePassThrough, presignedUrl, contentLength);

  console.log('[finalize-upload] Creating read stream and pipeline to feed PassThrough');
  const readStream = createReadStream(mergedFilePath, {
    highWaterMark: DEFAULT_STREAM_CHUNK_SIZE,
  });

  // Now pipe data into the PassThrough (which saveResult is already consuming)
  const { error: pipelineError } = await withError(pipeline(readStream, filePassThrough));

  if (pipelineError) {
    console.error('[finalize-upload] Error creating pipeline:', pipelineError);
    filePassThrough.destroy();

    return res.status(500).json({ error: `Failed to create stream: ${pipelineError.message}` });
  }
  console.log('[finalize-upload] Pipeline completed, waiting for saveResult...');

  // Wait for saveResult to complete
  const { error: saveError } = await withError(saveResultPromise);

  if (saveError) {
    console.error('[finalize-upload] Error saving result:', saveError);

    return res.status(500).json({ error: `Failed to save result: ${saveError.message}` });
  }
  console.log('[finalize-upload] Result saved successfully');

  // Ensure resultDetails has at least a default project if missing
  const finalResultDetails: Record<string, string> = {
    project: 'default',
    ...(resultDetails || {}),
  };

  // If project is empty string, use default
  if (!finalResultDetails.project || finalResultDetails.project.trim() === '') {
    finalResultDetails.project = 'default';
  }

  console.log(`[finalize-upload] About to call service.saveResultDetails for ${resultID}, size: ${totalSize}`);
  console.log('[finalize-upload] finalResultDetails:', JSON.stringify(finalResultDetails, null, 2));

  console.log('[finalize-upload] Calling service.saveResultDetails...');
  const { result: uploadResult, error: uploadResultDetailsError } = await withError(
    service.saveResultDetails(resultID, finalResultDetails, totalSize),
  );

  console.log('[finalize-upload] service.saveResultDetails completed');
  console.log('[finalize-upload] uploadResult:', uploadResult ? 'exists' : 'null');
  console.log(
    '[finalize-upload] uploadResultDetailsError:',
    uploadResultDetailsError ? uploadResultDetailsError.message : 'none',
  );

  if (uploadResultDetailsError) {
    console.error(`[finalize-upload] Failed to save result details:`, uploadResultDetailsError);
    await service.deleteResults([resultID]);

    return res.status(400).json({ error: `Upload result details failed: ${uploadResultDetailsError.message}` });
  }

  if (!uploadResult) {
    console.error(`[finalize-upload] uploadResult is null after saveResultDetails`);

    return res.status(500).json({ error: 'Failed to save result details: result is null' });
  }

  console.log(`[finalize-upload] Successfully saved result:`, uploadResult.resultID);
  console.log(`[finalize-upload] Result details:`, {
    resultID: uploadResult.resultID,
    project: uploadResult.project,
    createdAt: uploadResult.createdAt,
    size: uploadResult.size,
  });

  try {
    for (const chunkName of chunks) {
      await unlink(join(chunksDir, chunkName));
    }
    await rmdir(chunksDir);
    await unlink(mergedFilePath);
  } catch (cleanupError) {
    console.error('Error cleaning up chunks:', cleanupError);
  }

  let generatedReport = null;

  if (
    finalResultDetails?.shardCurrent &&
    finalResultDetails?.shardTotal &&
    finalResultDetails?.triggerReportGeneration === 'true'
  ) {
    const { result: results, error: resultsError } = await withError(
      service.getResults({
        testRun: finalResultDetails.testRun,
      }),
    );

    if (resultsError) {
      return res.status(500).json({ error: `Failed to generate report: ${resultsError.message}` });
    }

    const testRunResults = results?.results.filter(
      (result) =>
        result.testRun === finalResultDetails.testRun &&
        (finalResultDetails.project ? result.project === finalResultDetails.project : true),
    );

    if (testRunResults?.length === parseInt(finalResultDetails.shardTotal)) {
      const ids = testRunResults.map((result) => result.resultID);

      const { result, error } = await withError(
        service.generateReport(ids, {
          project: finalResultDetails.project,
          testRun: finalResultDetails.testRun,
          playwrightVersion: finalResultDetails.playwrightVersion,
        }),
      );

      if (error) {
        return res.status(500).json({ error: `Failed to generate report: ${error.message}` });
      }

      generatedReport = result;
    }
  }

  console.log('[finalize-upload] Preparing final response with uploadResult and generatedReport');
  const response = {
    message: 'Success',
    data: { ...uploadResult, generatedReport },
  };

  console.log('[finalize-upload] Sending response:', {
    hasUploadResult: !!uploadResult,
    hasGeneratedReport: !!generatedReport,
    resultID: uploadResult?.resultID,
  });

  return res.status(200).json(response);
}

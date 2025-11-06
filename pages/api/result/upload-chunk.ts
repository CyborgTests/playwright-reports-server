import type { NextApiRequest, NextApiResponse } from 'next';

import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import Busboy from 'busboy';

import { DEFAULT_STREAM_CHUNK_SIZE, TMP_FOLDER } from '@/app/lib/storage/constants';
import { withError } from '@/app/lib/withError';

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'PUT') {
      res.setHeader('Allow', 'PUT');

      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const uploadId = req.query.uploadId as string;
    const chunkIndex = parseInt(req.query.chunkIndex as string, 10);
    const totalChunks = parseInt(req.query.totalChunks as string, 10);
    const totalSize = parseInt(req.query.totalSize as string, 10);

    if (!uploadId || isNaN(chunkIndex) || isNaN(totalChunks) || isNaN(totalSize)) {
      return res
        .status(400)
        .json({ error: 'Missing required parameters: uploadId, chunkIndex, totalChunks, totalSize' });
    }

    const chunksDir = join(TMP_FOLDER, 'chunks', uploadId);

    const { error: mkdirError } = await withError(mkdir(chunksDir, { recursive: true }));

    if (mkdirError) {
      console.error('Error creating chunks directory:', mkdirError);

      return res.status(500).json({ error: `Failed to create chunks directory: ${mkdirError.message}` });
    }

    const chunkPath = join(chunksDir, `chunk-${chunkIndex}`);
    let fileSize = 0;

    console.log(`[upload-chunk] Processing chunk ${chunkIndex}/${totalChunks} for uploadId ${uploadId}`);

    const bb = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
      },
      highWaterMark: DEFAULT_STREAM_CHUNK_SIZE,
      fileHwm: DEFAULT_STREAM_CHUNK_SIZE,
    });

    const uploadPromise = new Promise<void>((resolve, reject) => {
      let fileReceived = false;
      let writeStream: WriteStream | null = null;

      bb.on('file', (_fieldName: string, fileStream: NodeJS.ReadableStream) => {
        fileReceived = true;

        writeStream = createWriteStream(chunkPath, {
          highWaterMark: DEFAULT_STREAM_CHUNK_SIZE,
        });

        writeStream.on('error', (error: Error) => {
          reject(error);
        });

        fileStream.on('data', (chunk: Buffer) => {
          fileSize += chunk.length;
        });

        pipeline(fileStream, writeStream)
          .then(() => {
            // Pipeline automatically ends the write stream when read stream ends
            resolve();
          })
          .catch((error) => {
            reject(error);
          });
      });

      bb.on('error', (error: Error) => {
        if (writeStream && !writeStream.destroyed) {
          writeStream.destroy();
        }
        reject(error);
      });

      bb.on('finish', () => {
        if (!fileReceived) {
          reject(new Error('No file received'));
        }
      });
    });

    const { error: streamPipelineError } = await withError(pipeline(req, bb));

    if (streamPipelineError) {
      console.error('Error processing chunk request:', streamPipelineError);

      return res.status(500).json({ error: `Upload chunk failed: ${streamPipelineError.message}` });
    }

    const { error: uploadError } = await withError(uploadPromise);

    if (uploadError) {
      console.error(`[upload-chunk] Error uploading chunk ${chunkIndex}:`, uploadError);
      const error = uploadError instanceof Error ? uploadError : new Error(String(uploadError));

      return res.status(400).json({ error: `Upload chunk failed: ${error.message}` });
    }

    console.log(`[upload-chunk] Successfully uploaded chunk ${chunkIndex}, size: ${fileSize} bytes`);

    return res.status(200).json({
      message: 'Chunk uploaded successfully',
      chunkIndex,
      size: fileSize,
    });
  } catch (error) {
    console.error('Unexpected error in upload-chunk handler:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (!res.headersSent) {
      return res.status(500).json({ error: `Internal server error: ${errorMessage}` });
    }
  }
}

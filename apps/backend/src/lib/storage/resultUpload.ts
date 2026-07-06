import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { STORAGE_TYPES } from '@playwright-reports/shared';
import { env } from '../../config/env.js';
import { withError } from '../withError.js';
import { DEFAULT_STREAM_CHUNK_SIZE, TMP_FOLDER } from './constants.js';
import { storage } from './index.js';
import type { S3 } from './s3.js';
import { CoordinatedTee } from './streamUtils.js';

export async function uploadResult(
  filename: string,
  stream: PassThrough,
  options?: {
    presignedUrl?: string;
    contentLength?: string;
    shouldStoreLocalCopy?: boolean;
  }
): Promise<void> {
  const uploadStream = new PassThrough({ highWaterMark: DEFAULT_STREAM_CHUNK_SIZE });

  let onUploadSuccess: (() => Promise<void>) | undefined;
  let onUploadFailure: (() => Promise<void>) | undefined;

  const usesRemoteStorage =
    env.DATA_STORAGE === STORAGE_TYPES.S3 || env.DATA_STORAGE === STORAGE_TYPES.AZURE;

  if (options?.shouldStoreLocalCopy && usesRemoteStorage) {
    const finalPath = path.join(TMP_FOLDER, 'results', filename);
    const partialPath = `${finalPath}.part`;
    const writeStream = createWriteStream(partialPath);

    let writeFailed = false;
    writeStream.on('error', (error) => {
      writeFailed = true;
      console.error(`[storage] local copy write error: ${error.message}`);
    });

    const writeSettled = new Promise<void>((resolve) => {
      writeStream.on('finish', () => resolve());
      writeStream.on('close', () => resolve());
    });

    const tee = new CoordinatedTee(writeStream, uploadStream, {
      highWaterMark: DEFAULT_STREAM_CHUNK_SIZE,
    });
    stream.pipe(tee);

    onUploadSuccess = async () => {
      await writeSettled;
      if (writeFailed) {
        await withError(fs.unlink(partialPath));
        return;
      }
      const { error } = await withError(fs.rename(partialPath, finalPath));
      if (error) {
        console.error(`[storage] local copy rename error: ${error.message}`);
        await withError(fs.unlink(partialPath));
      }
    };
    onUploadFailure = async () => {
      await writeSettled;
      await withError(fs.unlink(partialPath));
    };
  } else {
    stream.pipe(uploadStream);
  }

  try {
    if (!options?.presignedUrl) {
      await storage.saveResult(filename, uploadStream);
      await onUploadSuccess?.();
      return;
    }

    const { error } = await withError(
      fetch(options.presignedUrl, {
        method: 'PUT',
        body: Readable.toWeb(uploadStream, {
          strategy: {
            highWaterMark: DEFAULT_STREAM_CHUNK_SIZE,
          },
        }),
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': options.contentLength,
        },
        duplex: 'half',
      } as RequestInit)
    );

    if (error) {
      console.error(`[storage] presigned upload error: ${error.message}`);
      throw error;
    }

    await onUploadSuccess?.();
  } catch (err) {
    await onUploadFailure?.();
    throw err;
  }
}

export async function getPresignedUploadUrl(fileName: string): Promise<string> {
  if (env.DATA_STORAGE !== 's3') {
    return '';
  }

  const { result: presignedUrl, error } = await withError(
    (storage as S3).generatePresignedUploadUrl(fileName)
  );

  if (error) {
    console.error(`[storage] getPresignedUploadUrl error: ${error.message}`);
    return '';
  }

  if (!presignedUrl) {
    console.error(`[storage] presigned URL is null or undefined`);
    return '';
  }

  return presignedUrl;
}

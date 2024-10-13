import path from 'node:path';
import fs from 'node:fs/promises';

import mime from 'mime';
import { type NextRequest, NextResponse } from 'next/server';

import { DATA_FOLDER } from '@/app/lib/storage/constants';
import { withError } from '@/app/lib/withError';

export const dynamic = 'force-dynamic'; // defaults to auto

interface ServeParams {
  filePath?: string[];
}

export async function GET(
  _: NextRequest,
  {
    params,
  }: {
    params: ServeParams;
  },
) {
  const { filePath } = params;

  const uriPath = Array.isArray(filePath) ? filePath.join('/') : (filePath ?? '');

  const targetPath = decodeURI(uriPath);

  const contentType = mime.getType(path.basename(targetPath));

  if (!contentType && !path.extname(targetPath)) {
    return NextResponse.next();
  }

  const imageDataPath = path.join(process.cwd(), DATA_FOLDER, targetPath);
  const imagePublicPath = path.join(process.cwd(), 'public', targetPath);

  const { error: dataAccessError } = await withError(fs.access(imageDataPath));

  const imagePath = dataAccessError ? imagePublicPath : imageDataPath;

  const imageBuffer = await fs.readFile(imagePath);

  const headers = {
    headers: {
      'Content-Type': contentType ?? 'image/*',
    },
  };

  return new Response(imageBuffer, headers);
}

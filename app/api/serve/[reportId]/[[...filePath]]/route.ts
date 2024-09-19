import path from 'path';

import mime from 'mime';
import { type NextRequest, NextResponse } from 'next/server';

import { withError } from '@/app/lib/withError';
import { storage } from '@/app/lib/storage';

interface ReportParams {
  reportId: string;
  filePath?: string[];
}

export async function GET(
  req: NextRequest,
  {
    params,
  }: {
    params: ReportParams;
  },
) {
  const { reportId, filePath } = params;

  const file = Array.isArray(filePath) ? filePath.join('/') : (filePath ?? '');

  const targetPath = path.join(reportId, file);

  const contentType = mime.getType(path.basename(targetPath));

  if (!contentType && !path.extname(targetPath)) {
    return NextResponse.next();
  }

  const { result: content, error } = await withError(storage.readFile(targetPath, contentType));

  if (error ?? !content) {
    return NextResponse.json({ error: `Could not read file ${error?.message ?? ''}` }, { status: 404 });
  }

  const headers = {
    headers: {
      'Content-Type': contentType ?? 'application/octet-stream',
    },
  };

  return new Response(content, headers);
}

import path from 'path';

import mime from 'mime';
import { type NextRequest, NextResponse } from 'next/server';

import { withError } from '@/app/lib/withError';
import { readFile } from '@/app/lib/data';

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
  // TODO handle auth
  // const { token } = getExistingToken();

  // if (!token) {
  //   return redirect('/login');
  // }

  const { reportId, filePath } = params;

  const file = Array.isArray(filePath) ? filePath.join('/') : (filePath ?? '');

  const targetPath = path.join(reportId, file);

  try {
    const contentType = mime.getType(path.basename(targetPath));

    if (!contentType && !path.extname(targetPath)) {
      return NextResponse.next();
    }

    const { result: content, error } = await withError(readFile(targetPath, contentType));

    if (error ?? !content) {
      return NextResponse.json({ error: `Could not read file ${error?.message ?? ''}` }, { status: 404 });
    }

    const headers = {
      headers: {
        'Content-Type': contentType ?? 'application/octet-stream',
      },
    };

    return new Response(content, headers);
  } catch (error) {
    return NextResponse.json({ error: `Page not found: ${error}` }, { status: 404 });
  }
}

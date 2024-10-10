import path from 'path';

import mime from 'mime';
import { type NextRequest, NextResponse } from 'next/server';
import { redirect } from 'next/navigation';

import { withError } from '@/app/lib/withError';
import { storage } from '@/app/lib/storage';
import { auth } from '@/app/auth';

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
  const session = await auth();

  if (!session?.user?.jwtToken) {
    redirect(`/login?callbackUrl=${decodeURIComponent(req.nextUrl.pathname)}`);
  }

  const { filePath } = params;

  const targetPath = Array.isArray(filePath) ? filePath.join('/') : (filePath ?? '');

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
      Authorization: `Bearer ${session?.user?.apiToken}`,
    },
  };

  return new Response(content, headers);
}

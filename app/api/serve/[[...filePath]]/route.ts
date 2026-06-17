import path from 'path';
import { Readable } from 'node:stream';

import mime from 'mime';
import { type NextRequest, NextResponse } from 'next/server';
import { redirect } from 'next/navigation';

import { withError } from '@/app/lib/withError';
import { storage, type FileRange, type FileStreamResult } from '@/app/lib/storage';
import { auth } from '@/app/auth';
import { env } from '@/app/config/env';
import { withBase } from '@/app/lib/url';

interface ReportParams {
  reportId: string;
  filePath?: string[];
}

/**
 * Parse an HTTP Range header (e.g. "bytes=0-1023", "bytes=512-", "bytes=-256")
 * into a {@link FileRange}. The backend resolves open-ended and suffix ranges
 * against the file size. Returns null for a malformed / non-bytes range.
 */
function parseRangeHeader(rangeHeader: string): FileRange | null {
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);

  if (!match) return null;

  const [, rawStart, rawEnd] = match;

  if (rawStart === '' && rawEnd === '') return null;

  if (rawStart === '') {
    return { suffixLength: parseInt(rawEnd, 10) };
  }

  return {
    start: parseInt(rawStart, 10),
    end: rawEnd === '' ? undefined : parseInt(rawEnd, 10),
  };
}

/** Build a 200 (full) or 206 (partial) streaming response from a backend stream result. */
function streamResponse(result: FileStreamResult, headers: Record<string, string>, partial: boolean): Response {
  return new Response(Readable.toWeb(result.stream) as ReadableStream, {
    status: partial ? 206 : 200,
    headers: {
      ...headers,
      ...(partial ? { 'Content-Range': `bytes ${result.start}-${result.end}/${result.totalSize}` } : {}),
      'Content-Length': String(result.contentLength),
    },
  });
}

const fileError = (error: Error | null, status = 404) =>
  NextResponse.json({ error: `Could not read file ${error?.message ?? ''}` }, { status });

export async function GET(
  req: NextRequest,
  {
    params,
  }: {
    params: ReportParams;
  },
) {
  // is not protected by the middleware
  // as we want to have callbackUrl in the query

  const authRequired = !!env.API_TOKEN;
  const session = await auth();

  const { filePath } = params;

  const uriPath = Array.isArray(filePath) ? filePath.join('/') : (filePath ?? '');

  const targetPath = decodeURI(uriPath);

  // Only check for session if auth is required
  if (authRequired && !session?.user?.jwtToken) {
    redirect(withBase(`/login?callbackUrl=${encodeURI(req.nextUrl.pathname)}`));
  }

  const contentType = mime.getType(path.basename(targetPath));

  if (!contentType && !path.extname(targetPath)) {
    return NextResponse.next();
  }

  const commonHeaders: Record<string, string> = {
    'Content-Type': contentType ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    Authorization: `Bearer ${session?.user?.apiToken}`,
  };

  const rangeHeader = req.headers.get('range');
  const range = rangeHeader ? parseRangeHeader(rangeHeader) : null;

  // Ranged request — serve a single 206 partial response. Suffix ("bytes=-N") and
  // open-ended ("bytes=X-") ranges are resolved against the file size by the backend.
  if (range) {
    const { result, error } = await withError(storage.readFileStream(targetPath, range));

    if (error ?? !result) {
      return fileError(error);
    }

    // Requested start is past the end of the file — Range Not Satisfiable.
    if (range.start !== undefined && range.start > result.totalSize - 1) {
      result.stream.destroy();

      return new Response(null, {
        status: 416,
        headers: { ...commonHeaders, 'Content-Range': `bytes */${result.totalSize}` },
      });
    }

    return streamResponse(result, commonHeaders, true);
  }

  // No Range header but it's a streamable type — stream the whole file rather than
  // buffering it entirely into server memory.
  if (contentType?.startsWith('video/')) {
    const { result, error } = await withError(storage.readFileStream(targetPath));

    if (error ?? !result) {
      return fileError(error);
    }

    return streamResponse(result, commonHeaders, false);
  }

  // Default: buffered path (HTML, small assets, malformed Range headers).
  const { result: content, error } = await withError(storage.readFile(targetPath, contentType));

  if (error ?? !content) {
    return fileError(error);
  }

  return new Response(content, { headers: commonHeaders });
}

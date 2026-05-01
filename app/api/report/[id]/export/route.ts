import path from 'node:path';

import JSZip from 'jszip';
import { type NextRequest } from 'next/server';

import { withError } from '@/app/lib/withError';
import { service } from '@/app/lib/service';
import { storage } from '@/app/lib/storage';

export const dynamic = 'force-dynamic';

// Longer timeout for PDF generation
export const maxDuration = 120;

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_');
}

async function exportZip(reportId: string, project: string, title: string): Promise<Response> {
  const { result: files, error: listError } = await withError(storage.listReportFiles(reportId, project));

  if (listError || !files) {
    return new Response(`failed to list report files: ${listError?.message ?? 'unknown error'}`, { status: 500 });
  }

  const zip = new JSZip();

  for (const file of files) {
    const { result: content, error: readError } = await withError(storage.readFile(file.storagePath, null));

    if (readError || content === undefined || content === null) {
      console.error(`[export] failed to read ${file.storagePath}: ${readError?.message}`);
      continue;
    }

    const fileData = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;

    zip.file(file.relativePath, fileData);
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeFilename(title)}.zip"`,
    },
  });
}

async function exportPdf(
  reportId: string,
  project: string,
  title: string,
  req: NextRequest,
): Promise<Response> {
  let chromium: typeof import('@playwright/test').chromium;

  try {
    const pw = await import('@playwright/test');

    chromium = pw.chromium;
  } catch {
    return new Response('Playwright is not available in this environment', { status: 500 });
  }

  const host = req.headers.get('host') ?? 'localhost:3000';
  const protocol = req.headers.get('x-forwarded-proto') ?? 'http';
  const projectSegment = project ? `${encodeURIComponent(project)}/` : '';
  const reportUrl = `${protocol}://${host}/api/serve/${projectSegment}${reportId}/index.html`;

  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

  const browser = await chromium.launch({
    executablePath: executablePath || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const context = await browser.newContext();

    // Forward session cookies so the report loads when auth is enabled
    const cookieHeader = req.headers.get('cookie');

    if (cookieHeader) {
      const cookies = cookieHeader.split(';').map((pair) => {
        const [name, ...rest] = pair.trim().split('=');

        return {
          name: name.trim(),
          value: rest.join('=').trim(),
          domain: host.split(':')[0],
          path: '/',
        };
      });

      await context.addCookies(cookies);
    }

    const page = await context.newPage();

    await page.goto(reportUrl, { waitUntil: 'networkidle', timeout: 60_000 });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });

    return new Response(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeFilename(title)}.pdf"`,
      },
    });
  } finally {
    await browser.close();
  }
}

export async function GET(
  req: NextRequest,
  {
    params,
  }: {
    params: { id: string };
  },
) {
  const { id } = params;

  if (!id) {
    return new Response('report ID is required', { status: 400 });
  }

  const format = req.nextUrl.searchParams.get('format') ?? 'zip';

  if (format !== 'zip' && format !== 'pdf') {
    return new Response('format must be "zip" or "pdf"', { status: 400 });
  }

  const { result: report, error } = await withError(service.getReport(id));

  if (error || !report) {
    return new Response(`failed to get report: ${error?.message ?? 'unknown error'}`, { status: 404 });
  }

  const title = report.title || report.reportID;
  const project = report.project ?? '';
  const reportPath = path.join(project, id);

  console.log(`[export] format=${format} report=${reportPath}`);

  if (format === 'zip') {
    return exportZip(id, project, title);
  }

  return exportPdf(id, project, title, req);
}

import path from 'node:path';

import JSZip from 'jszip';
import { type NextRequest } from 'next/server';
import { redirect } from 'next/navigation';

import { withError } from '@/app/lib/withError';
import { service } from '@/app/lib/service';
import { storage } from '@/app/lib/storage';
import { auth } from '@/app/auth';
import { env } from '@/app/config/env';
import { withBase } from '@/app/lib/url';
import { parse } from '@/app/lib/parser';
import { ReportTestOutcome, type ReportInfo, type ReportTest } from '@/app/lib/parser/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_');
}

// ─── Auth guard (same pattern as /api/serve) ─────────────────────────────────

async function guardAuth(req: NextRequest) {
  const authRequired = !!env.API_TOKEN;
  const session = await auth();

  if (authRequired && !session?.user?.jwtToken) {
    redirect(withBase(`/login?callbackUrl=${encodeURI(req.nextUrl.pathname + req.nextUrl.search)}`));
  }
}

// ─── ZIP export ───────────────────────────────────────────────────────────────

async function exportZip(reportId: string, project: string, title: string): Promise<Response> {
  const { result: files, error: listError } = await withError(storage.listReportFiles(reportId, project));

  if (listError || !files) {
    return new Response(`failed to list report files: ${listError?.message ?? 'unknown error'}`, { status: 500 });
  }

  const zip = new JSZip();

  for (const file of files) {
    const { result: content, error: readError } = await withError(storage.readFile(file.storagePath, null));

    if (readError || content === undefined || content === null) {
      console.error(`[download] failed to read ${file.storagePath}: ${readError?.message}`);
      continue;
    }

    zip.file(file.relativePath, typeof content === 'string' ? Buffer.from(content, 'utf-8') : content);
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeFilename(title)}.zip"`,
    },
  });
}

// ─── Playwright SPA PDF export ────────────────────────────────────────────────

async function exportPdf(reportId: string, project: string, title: string, req: NextRequest): Promise<Response> {
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
    const cookieHeader = req.headers.get('cookie');

    if (cookieHeader) {
      const cookies = cookieHeader.split(';').map((pair) => {
        const [name, ...rest] = pair.trim().split('=');

        return { name: name.trim(), value: rest.join('=').trim(), domain: host.split(':')[0], path: '/' };
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

// ─── Evidence PDF: test name + screenshot per test ────────────────────────────

const outcomeColor: Record<ReportTestOutcome, string> = {
  [ReportTestOutcome.Expected]: '#16a34a',
  [ReportTestOutcome.Unexpected]: '#dc2626',
  [ReportTestOutcome.Flaky]: '#d97706',
  [ReportTestOutcome.Skipped]: '#6b7280',
};

const outcomeLabel: Record<ReportTestOutcome, string> = {
  [ReportTestOutcome.Expected]: 'PASSED',
  [ReportTestOutcome.Unexpected]: 'FAILED',
  [ReportTestOutcome.Flaky]: 'FLAKY',
  [ReportTestOutcome.Skipped]: 'SKIPPED',
};

async function readScreenshotAsDataUrl(
  screenshotPath: string,
  reportId: string,
  project: string,
): Promise<string | null> {
  const storagePath = path.join(project, reportId, screenshotPath);
  const { result: buf, error } = await withError(storage.readFile(storagePath, null));

  if (error || !buf) return null;

  const b64 = Buffer.isBuffer(buf) ? buf.toString('base64') : Buffer.from(buf as string, 'binary').toString('base64');
  const ext = path.extname(screenshotPath).replace('.', '') || 'png';
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';

  return `data:${mime};base64,${b64}`;
}

function buildTestRow(test: ReportTest, screenshotDataUrl: string | null): string {
  const fullName = [...test.path, test.title].join(' › ');
  const color = outcomeColor[test.outcome];
  const label = outcomeLabel[test.outcome];
  const durationSec = (test.duration / 1000).toFixed(1);

  const screenshotHtml = screenshotDataUrl
    ? `<img alt="screenshot" src="${screenshotDataUrl}" style="max-width:100%;border:1px solid #e5e7eb;border-radius:4px;margin-top:8px;" />`
    : '';

  return `
    <div style="break-inside:avoid;margin-bottom:24px;padding:16px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;">
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <span style="flex-shrink:0;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;color:#fff;background:${color};">${label}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:#111;word-break:break-word;">${fullName}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:2px;">${test.location.file}:${test.location.line} &nbsp;·&nbsp; ${durationSec}s</div>
        </div>
      </div>
      ${screenshotHtml}
    </div>`;
}

function buildEvidenceHtml(info: ReportInfo, title: string, reportId: string, testRows: string[]): string {
  const { stats } = info;
  const passRate = stats.total > 0 ? Math.round((stats.expected / stats.total) * 100) : 0;
  const date = new Date().toLocaleString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; color: #111; padding: 32px; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .meta { font-size: 12px; color: #6b7280; margin-bottom: 20px; }
  .summary { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 28px; padding: 16px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; }
  .stat { text-align: center; }
  .stat-value { font-size: 24px; font-weight: 700; }
  .stat-label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; }
  .section-title { font-size: 13px; font-weight: 600; color: #374151; margin: 24px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #e5e7eb; }
  @media print { body { padding: 0; background: #fff; } }
</style>
</head>
<body>
  <h1>${title}</h1>
  <div class="meta">Generated ${date} &nbsp;·&nbsp; Report ID: ${reportId}</div>
  <div class="summary">
    <div class="stat"><div class="stat-value" style="color:#111;">${stats.total}</div><div class="stat-label">Total</div></div>
    <div class="stat"><div class="stat-value" style="color:#16a34a;">${stats.expected}</div><div class="stat-label">Passed</div></div>
    <div class="stat"><div class="stat-value" style="color:#dc2626;">${stats.unexpected}</div><div class="stat-label">Failed</div></div>
    <div class="stat"><div class="stat-value" style="color:#d97706;">${stats.flaky}</div><div class="stat-label">Flaky</div></div>
    <div class="stat"><div class="stat-value" style="color:#6b7280;">${stats.skipped}</div><div class="stat-label">Skipped</div></div>
    <div class="stat"><div class="stat-value" style="color:#2563eb;">${passRate}%</div><div class="stat-label">Pass Rate</div></div>
  </div>
  ${testRows.join('\n')}
</body>
</html>`;
}

async function exportEvidence(
  reportId: string,
  project: string,
  title: string,
): Promise<Response> {
  // Read and parse the report HTML to get full test tree with attachments
  const indexPath = path.join(project, reportId, 'index.html');
  const { result: htmlContent, error: readError } = await withError(storage.readFile(indexPath, 'text/html'));

  if (readError || !htmlContent) {
    return new Response('failed to read report html', { status: 500 });
  }

  const { result: info, error: parseError } = await withError(parse(htmlContent.toString()));

  if (parseError || !info) {
    return new Response('failed to parse report data', { status: 500 });
  }

  // Build one HTML block per test, embedding the first screenshot attachment
  const testRows: string[] = [];

  for (const file of info.files) {
    testRows.push(`<div class="section-title">${file.fileName}</div>`);

    for (const test of file.tests) {
      // Find the first screenshot attachment across all results
      let screenshotDataUrl: string | null = null;

      for (const result of test.results) {
        for (const attachment of result.attachments) {
          if (attachment.contentType.startsWith('image/') && attachment.path) {
            screenshotDataUrl = await readScreenshotAsDataUrl(attachment.path, reportId, project);
            if (screenshotDataUrl) break;
          }
        }
        if (screenshotDataUrl) break;
      }

      testRows.push(buildTestRow(test, screenshotDataUrl));
    }
  }

  const html = buildEvidenceHtml(info, title, reportId, testRows);

  // Render to PDF via Playwright
  let chromium: typeof import('@playwright/test').chromium;

  try {
    const pw = await import('@playwright/test');

    chromium = pw.chromium;
  } catch {
    return new Response('Playwright is not available in this environment', { status: 500 });
  }

  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch({
    executablePath: executablePath || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();

    await page.setContent(html, { waitUntil: 'networkidle' });

    const headerHtml = `
      <div style="width:100%;font-family:sans-serif;font-size:9px;color:#6b7280;padding:0 15mm;display:flex;justify-content:space-between;">
        <span>${title}</span>
        <span>${new Date().toLocaleDateString()}</span>
      </div>`;

    const footerHtml = `
      <div style="width:100%;font-family:sans-serif;font-size:9px;color:#6b7280;padding:0 15mm;display:flex;justify-content:space-between;">
        <span>Playwright Reports Server</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>`;

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: headerHtml,
      footerTemplate: footerHtml,
      // top/bottom margin must be large enough to clear the header/footer
      margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
    });

    return new Response(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeFilename(title)}_evidence.pdf"`,
      },
    });
  } finally {
    await browser.close();
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  {
    params,
  }: {
    params: { id: string };
  },
) {
  await guardAuth(req);

  const { id } = params;

  if (!id) return new Response('report ID is required', { status: 400 });

  const format = req.nextUrl.searchParams.get('format') ?? 'zip';

  if (!['zip', 'pdf', 'evidence'].includes(format)) {
    return new Response('format must be "zip", "pdf", or "evidence"', { status: 400 });
  }

  const { result: report, error } = await withError(service.getReport(id));

  if (error || !report) {
    return new Response(`failed to get report: ${error?.message ?? 'unknown error'}`, { status: 404 });
  }

  const title = report.title || report.reportID;
  const project = report.project ?? '';

  console.log(`[download] format=${format} report=${path.join(project, id)}`);

  if (format === 'zip') return exportZip(id, project, title);
  if (format === 'evidence') return exportEvidence(id, project, title);

  return exportPdf(id, project, title, req);
}

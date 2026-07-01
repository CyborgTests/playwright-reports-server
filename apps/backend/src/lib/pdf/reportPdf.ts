import type { ReportAnalysisStructured } from '@playwright-reports/shared';
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib';

// Programmatic PDF export - no headless browser.
// The route assembles the data; this module only draws. 
// Screenshots are pre-loaded by the caller (async I/O stays out of the layout pass).

export interface PdfReportStats {
  total: number;
  expected: number;
  unexpected: number;
  flaky: number;
  skipped: number;
}

export interface PdfScreenshot {
  data: Uint8Array;
  contentType: string;
}

export interface PdfFailureCard {
  testId: string;
  title: string;
  location: string;
  outcome: string;
  durationMs?: number;
  category?: string;
  errorMessage?: string;
  screenshot?: PdfScreenshot;
  analysis?: { text: string; model: string };
}

export interface PdfTestRow {
  title: string;
  file: string;
  outcome: string;
  durationMs?: number;
}

export interface PdfDiffEntry {
  title: string;
  file?: string;
}

export interface PdfDiff {
  baselineDisplayNumber?: number;
  baselineTitle?: string;
  baselineCreatedAt?: string;
  newlyFailed: PdfDiffEntry[];
  fixed: PdfDiffEntry[];
  stillFailing: PdfDiffEntry[];
}

export interface ReportPdfInput {
  report: {
    reportID: string;
    project: string;
    title?: string;
    displayNumber?: number;
    createdAt: string;
    durationMs?: number;
    stats: PdfReportStats;
    passRate: number | null;
    gitShortHash?: string;
    gitBranch?: string;
    gitSubject?: string;
    ciBuildHref?: string;
    playwrightVersion?: string;
  };
  failures: PdfFailureCard[];
  allTests?: PdfTestRow[];
  structured?: ReportAnalysisStructured | null;
  categories?: Record<string, number>;
  llmModel?: string | null;
  diff?: PdfDiff | null;
  baseUrl: string;
  generatedAt: string;
  onePerPage: boolean;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 46;
const CONTENT_WIDTH = A4[0] - 2 * MARGIN;

const FAILING_OUTCOMES = new Set(['unexpected', 'failed', 'flaky', 'timedOut']);
export const isFailingOutcome = (outcome: string): boolean => FAILING_OUTCOMES.has(outcome);

function formatDuration(ms: number | undefined): string {
  if (ms == null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export async function buildReportPdf(input: ReportPdfInput): Promise<Uint8Array> {
  const { report } = input;
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const monoFont = await doc.embedFont(StandardFonts.Courier);

  const color = {
    ink: rgb(0.1, 0.11, 0.18),
    muted: rgb(0.42, 0.45, 0.52),
    line: rgb(0.85, 0.87, 0.9),
    green: rgb(0.09, 0.64, 0.29),
    red: rgb(0.86, 0.15, 0.15),
    amber: rgb(0.85, 0.47, 0.02),
    blue: rgb(0.15, 0.39, 0.92),
    white: rgb(1, 1, 1),
    codeBg: rgb(0.13, 0.14, 0.2),
    codeInk: rgb(0.92, 0.94, 0.98),
  };

  const pages: PDFPage[] = [];
  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - MARGIN;
  pages.push(page);

  function newPage(): void {
    page = doc.addPage(A4);
    pages.push(page);
    y = A4[1] - MARGIN;
  }
  function need(height: number): void {
    if (y - height < MARGIN + 26) newPage();
  }
  function forceNewPage(): void {
    if (y < A4[1] - MARGIN - 1) newPage();
  }

  function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const words = String(text).split(/\s+/);
    const out: string[] = [];
    for (const word of words) {
      if (out.length === 0) {
        out.push(word);
        continue;
      }
      const candidate = `${out[out.length - 1]} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= width) out[out.length - 1] = candidate;
      else out.push(word);
    }
    // hard-break overlong tokens (URLs, locators, stack frames)
    const fixed: string[] = [];
    for (const lineText of out) {
      if (font.widthOfTextAtSize(lineText, size) <= width) {
        fixed.push(lineText);
        continue;
      }
      let current = '';
      for (const ch of lineText) {
        if (font.widthOfTextAtSize(current + ch, size) <= width) current += ch;
        else {
          fixed.push(current);
          current = ch;
        }
      }
      if (current) fixed.push(current);
    }
    return fixed.length ? fixed : [''];
  }

  interface TextOptions {
    font?: PDFFont;
    size?: number;
    color?: ReturnType<typeof rgb>;
    indent?: number;
    width?: number;
    gap?: number;
  }
  function text(value: string, options: TextOptions = {}): void {
    const font = options.font ?? reg;
    const size = options.size ?? 10;
    const fill = options.color ?? color.ink;
    const indent = options.indent ?? 0;
    const width = (options.width ?? CONTENT_WIDTH) - indent;
    const lineHeight = size * 1.32;
    for (const rawLine of String(value).split('\n')) {
      for (const lineText of wrap(rawLine, font, size, width)) {
        need(lineHeight);
        page.drawText(lineText, { x: MARGIN + indent, y: y - size, size, font, color: fill });
        y -= lineHeight;
      }
    }
    y -= options.gap ?? 3;
  }

  function rule(gap = 8): void {
    need(gap + 2);
    page.drawLine({
      start: { x: MARGIN, y: y - gap / 2 },
      end: { x: A4[0] - MARGIN, y: y - gap / 2 },
      thickness: 0.6,
      color: color.line,
    });
    y -= gap;
  }

  function sectionTitle(value: string): void {
    need(28);
    y -= 6;
    page.drawText(value, { x: MARGIN, y: y - 12, size: 12.5, font: bold, color: color.ink });
    y -= 22;
  }

  const outcomeStyle: Record<string, { label: string; fill: ReturnType<typeof rgb> }> = {
    unexpected: { label: 'FAIL', fill: color.red },
    failed: { label: 'FAIL', fill: color.red },
    timedOut: { label: 'FAIL', fill: color.red },
    flaky: { label: 'FLAKY', fill: color.amber },
    expected: { label: 'PASS', fill: color.green },
    passed: { label: 'PASS', fill: color.green },
    skipped: { label: 'SKIP', fill: color.muted },
  };
  function badge(outcome: string, x: number, yTop: number): number {
    const style = outcomeStyle[outcome] ?? outcomeStyle.skipped;
    const width = bold.widthOfTextAtSize(style.label, 7) + 10;
    page.drawRectangle({ x, y: yTop - 11, width, height: 12, color: style.fill, opacity: 0.16 });
    page.drawText(style.label, { x: x + 5, y: yTop - 9, size: 7, font: bold, color: style.fill });
    return width;
  }

  // ---------- 1. cover band ----------
  page.drawRectangle({ x: 0, y: A4[1] - 96, width: A4[0], height: 96, color: color.ink });
  page.drawText('TEST EVIDENCE REPORT', {
    x: MARGIN,
    y: A4[1] - 38,
    size: 16,
    font: bold,
    color: color.white,
  });
  page.drawText(report.title ?? `${report.project} #${report.displayNumber ?? ''}`, {
    x: MARGIN,
    y: A4[1] - 58,
    size: 11,
    font: reg,
    color: rgb(0.8, 0.83, 0.9),
  });
  page.drawText(`${report.project}  ·  run #${report.displayNumber ?? '—'}`, {
    x: MARGIN,
    y: A4[1] - 76,
    size: 9,
    font: reg,
    color: rgb(0.65, 0.7, 0.8),
  });
  if (input.structured?.verdict) {
    const verdict = input.structured.verdict.toUpperCase();
    const width = bold.widthOfTextAtSize(verdict, 9) + 16;
    page.drawRectangle({
      x: A4[0] - MARGIN - width,
      y: A4[1] - 50,
      width,
      height: 18,
      color: color.amber,
    });
    page.drawText(verdict, {
      x: A4[0] - MARGIN - width + 8,
      y: A4[1] - 45,
      size: 9,
      font: bold,
      color: color.white,
    });
  }
  y = A4[1] - 96 - 18;

  text(`Commit: ${report.gitShortHash ?? '—'}  "${(report.gitSubject ?? '').slice(0, 70)}"`, {
    size: 8.5,
    color: color.muted,
    gap: 1,
  });
  text(
    `Branch: ${report.gitBranch ?? 'n/a'}${report.ciBuildHref ? `   ·   CI build: ${report.ciBuildHref}` : ''}`,
    { size: 8.5, color: color.muted, gap: 1 }
  );
  text(
    `Run at: ${report.createdAt}   ·   Duration: ${formatDuration(report.durationMs)}   ·   Playwright: ${report.playwrightVersion ?? 'n/a'}`,
    { size: 8.5, color: color.muted, gap: 1 }
  );
  text(`Report ID: ${report.reportID}   ·   Generated: ${input.generatedAt}`, {
    size: 8.5,
    color: color.muted,
  });
  rule(10);

  // ---------- 2. summary panel ----------
  sectionTitle('Summary');
  const stats: Array<[string, string | number, ReturnType<typeof rgb>]> = [
    ['Total', report.stats.total, color.ink],
    ['Passed', report.stats.expected, color.green],
    ['Failed', report.stats.unexpected, color.red],
    ['Flaky', report.stats.flaky, color.amber],
    ['Skipped', report.stats.skipped, color.muted],
    ['Pass rate', report.passRate == null ? '—' : `${report.passRate.toFixed(1)}%`, color.blue],
  ];
  need(46);
  const cellWidth = CONTENT_WIDTH / stats.length;
  stats.forEach((stat, index) => {
    const x = MARGIN + index * cellWidth;
    page.drawText(String(stat[1]), { x, y: y - 16, size: 17, font: bold, color: stat[2] });
    page.drawText(stat[0], { x, y: y - 30, size: 8, font: reg, color: color.muted });
  });
  y -= 42;
  const total = report.stats.total || 1;
  const barHeight = 9;
  const segments: Array<[number, ReturnType<typeof rgb>]> = [
    [report.stats.expected, color.green],
    [report.stats.flaky, color.amber],
    [report.stats.unexpected, color.red],
    [report.stats.skipped, color.line],
  ];
  let barX = MARGIN;
  need(barHeight + 6);
  for (const [count, fill] of segments) {
    const width = (count / total) * CONTENT_WIDTH;
    if (width > 0)
      page.drawRectangle({ x: barX, y: y - barHeight, width, height: barHeight, color: fill });
    barX += width;
  }
  y -= barHeight + 10;
  if (input.categories && Object.keys(input.categories).length > 0) {
    text(
      `Failure categories: ${Object.entries(input.categories)
        .map(([name, count]) => `${name} (${count})`)
        .join('   ·   ')}`,
      { size: 9, color: color.muted }
    );
  }
  rule(10);

  // ---------- 3. report-level LLM analysis ----------
  if (input.structured) {
    sectionTitle('LLM Failure Analysis');
    if (input.llmModel) {
      text(`Model: ${input.llmModel}   ·   Verdict: ${input.structured.verdict}`, {
        size: 8.5,
        color: color.muted,
        gap: 4,
      });
    }
    if (input.structured.summary) text(input.structured.summary, { size: 10 });
    for (const section of input.structured.sections ?? []) {
      text(section.heading, { font: bold, size: 10, gap: 1 });
      if (section.body) text(section.body, { size: 9.5, indent: 8 });
      if (section.impact)
        text(`Impact: ${section.impact}`, { size: 9, indent: 8, color: color.muted });
      if (section.codeRefs?.length) {
        text(`Code: ${section.codeRefs.map((ref) => ref.label).join(', ')}`, {
          size: 9,
          indent: 8,
          font: monoFont,
          color: color.blue,
        });
      }
    }
    rule(10);
  }

  // ---------- 4. comparison vs previous ----------
  if (input.diff) {
    forceNewPage();
    sectionTitle(`Comparison vs run #${input.diff.baselineDisplayNumber ?? '—'}`);
    text(
      `Baseline: #${input.diff.baselineDisplayNumber ?? '—'} "${input.diff.baselineTitle ?? ''}"${
        input.diff.baselineCreatedAt ? ` (${input.diff.baselineCreatedAt})` : ''
      }`,
      { size: 8.5, color: color.muted, gap: 4 }
    );
    text(
      `Newly failed: ${input.diff.newlyFailed.length}    ·    Still failing: ${input.diff.stillFailing.length}    ·    Fixed: ${input.diff.fixed.length}`,
      { size: 9.5, font: bold }
    );
    for (const entry of input.diff.newlyFailed) {
      text(`+ NEW  ${entry.title}${entry.file ? `  (${entry.file})` : ''}`, {
        size: 9,
        indent: 8,
        color: color.red,
        font: monoFont,
      });
    }
    for (const entry of input.diff.fixed) {
      text(`- FIXED  ${entry.title}`, { size: 9, indent: 8, color: color.green, font: monoFont });
    }
    rule(10);
  }

  // ---------- 5. per-test failure detail ----------
  let firstFailure = true;
  for (const failure of input.failures) {
    if (input.onePerPage) forceNewPage();
    if (firstFailure || input.onePerPage) {
      sectionTitle('Failure Detail');
      firstFailure = false;
    }
    need(40);
    y -= 4;
    const badgeWidth = badge(failure.outcome, MARGIN, y);
    page.drawText(failure.title, {
      x: MARGIN + badgeWidth + 8,
      y: y - 9,
      size: 10.5,
      font: bold,
      color: color.ink,
    });
    y -= 16;
    text(
      `${failure.location}   ·   ${formatDuration(failure.durationMs)}   ·   category: ${failure.category ?? '—'}`,
      { size: 8.5, color: color.muted, gap: 4 }
    );

    if (failure.errorMessage) {
      const messageLines = failure.errorMessage
        .split('\n')
        .slice(0, 12)
        .flatMap((line) => wrap(line, monoFont, 7.5, CONTENT_WIDTH - 16));
      const blockHeight = messageLines.length * 10 + 10;
      need(blockHeight);
      page.drawRectangle({
        x: MARGIN,
        y: y - blockHeight + 4,
        width: CONTENT_WIDTH,
        height: blockHeight,
        color: color.codeBg,
      });
      let lineY = y - 6;
      for (const lineText of messageLines) {
        page.drawText(lineText, {
          x: MARGIN + 8,
          y: lineY - 7,
          size: 7.5,
          font: monoFont,
          color: color.codeInk,
        });
        lineY -= 10;
      }
      y -= blockHeight + 6;
    }

    if (failure.screenshot) {
      const isJpeg = /jpe?g/i.test(failure.screenshot.contentType);
      const image = isJpeg
        ? await doc.embedJpg(failure.screenshot.data)
        : await doc.embedPng(failure.screenshot.data);
      // full content width, downscale-only; cap height so it fits above the footer
      const maxHeight = A4[1] * 0.55;
      let scale = Math.min(CONTENT_WIDTH / image.width, 1);
      if (image.height * scale > maxHeight) scale = maxHeight / image.height;
      const width = image.width * scale;
      const height = image.height * scale;
      text('Screenshot:', { size: 8.5, color: color.muted, gap: 2 });
      need(height + 6);
      page.drawImage(image, { x: MARGIN, y: y - height, width, height });
      page.drawRectangle({
        x: MARGIN,
        y: y - height,
        width,
        height,
        borderColor: color.line,
        borderWidth: 0.6,
      });
      y -= height + 8;
    }

    if (failure.analysis) {
      text(`LLM analysis (${failure.analysis.model}):`, {
        size: 8.5,
        font: bold,
        color: color.blue,
        gap: 1,
      });
      text(failure.analysis.text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'), { size: 9, indent: 8 });
    }

    text(`Open in report:  ${input.baseUrl}/api/serve/${report.reportID}/index.html`, {
      size: 8,
      color: color.blue,
      font: monoFont,
      gap: 6,
    });
    rule(8);
  }

  // ---------- 6. full enumeration (scope=all) ----------
  if (input.allTests && input.allTests.length > 0) {
    forceNewPage();
    sectionTitle(`All Tests (${input.allTests.length})`);
    for (const testRow of input.allTests) {
      need(13);
      const badgeWidth = badge(testRow.outcome, MARGIN, y);
      page.drawText(testRow.title.slice(0, 80), {
        x: MARGIN + badgeWidth + 8,
        y: y - 9,
        size: 8.5,
        font: reg,
        color: color.ink,
      });
      page.drawText(testRow.file.slice(0, 60), {
        x: MARGIN + 260,
        y: y - 9,
        size: 7.5,
        font: reg,
        color: color.muted,
      });
      const right = formatDuration(testRow.durationMs);
      page.drawText(right, {
        x: A4[0] - MARGIN - reg.widthOfTextAtSize(right, 8),
        y: y - 9,
        size: 8,
        font: reg,
        color: color.muted,
      });
      y -= 13;
    }
  }

  // ---------- footer (final pass, total page count known) ----------
  const totalPages = pages.length;
  pages.forEach((footerPage, index) => {
    footerPage.drawLine({
      start: { x: MARGIN, y: 30 },
      end: { x: A4[0] - MARGIN, y: 30 },
      thickness: 0.5,
      color: color.line,
    });
    footerPage.drawText(
      `${report.project} · run #${report.displayNumber ?? '—'} · ${report.reportID}`,
      {
        x: MARGIN,
        y: 19,
        size: 7,
        font: reg,
        color: color.muted,
      }
    );
    const pageLabel = `Page ${index + 1} of ${totalPages}`;
    footerPage.drawText(pageLabel, {
      x: A4[0] - MARGIN - reg.widthOfTextAtSize(pageLabel, 7),
      y: 19,
      size: 7,
      font: reg,
      color: color.muted,
    });
  });

  return doc.save();
}

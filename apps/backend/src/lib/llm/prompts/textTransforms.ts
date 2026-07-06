import { stripAnsi } from '../../ansi.js';

export function unescapeLiteralNewlines(text: string): string {
  if (!text || !/\\+[ntr"]/.test(text)) return text;
  return text
    .replace(/\\+n/g, '\n')
    .replace(/\\+t/g, '\t')
    .replace(/\\+r/g, '\r')
    .replace(/\\+"/g, '"');
}

// Minimum length of an identical-line run before we collapse it.
const REPEAT_RUN_MIN = 3;

export function stripLogNoise(text: string): string {
  if (!text) return text;
  const lines = stripAnsi(text).split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    let run = 1;
    while (i + run < lines.length && lines[i + run] === line) run++;
    out.push(line);
    if (run >= REPEAT_RUN_MIN) {
      out.push(`[… previous line repeated ${run}× …]`);
    } else {
      for (let k = 1; k < run; k++) out.push(line);
    }
    i += run;
  }
  return out.join('\n');
}

export function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const marker = (omitted: number) => `\n[… ${omitted} chars omitted …]\n`;
  const sample = marker(text.length);
  if (maxChars <= sample.length + 8) {
    return `${text.substring(0, Math.max(0, maxChars - 1))}…`;
  }
  const keep = maxChars - sample.length;
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  const omitted = text.length - keep;
  return text.substring(0, head) + marker(omitted) + text.substring(text.length - tail);
}

export function extractRootCauseParagraph(markdown: string, fallbackChars = 600): string {
  if (!markdown) return '';
  const rootCauseRe = /^#{1,3}\s*(?:🔍\s*)?Root Cause\b.*$/im;
  const startMatch = markdown.match(rootCauseRe);
  if (!startMatch) {
    const trimmed = markdown.trim();
    return trimmed.length > fallbackChars
      ? `${trimmed.substring(0, fallbackChars).trim()}…`
      : trimmed;
  }
  const startIdx = (startMatch.index ?? 0) + startMatch[0].length;
  const tail = markdown.slice(startIdx);
  const endMatch = tail.match(/\n#{1,3}\s/);
  const body = endMatch ? tail.slice(0, endMatch.index) : tail;
  return body.replace(/^\s+|\s+$/g, '');
}

/**
 * Pull the first app-code frame out of a Playwright stack trace.
 *
 * Playwright stacks typically interleave four kinds of frames:
 *   1. The user's spec / app code   ← what we want
 *   2. Playwright internals          ← drop
 *   3. node_modules dependencies     ← drop
 *   4. Node internals (node:async_hooks, etc.) ← drop
 *
 * Returned format: `"<normalized path>:<line>"`. The path is normalized to
 * forward slashes and stripped of the absolute prefix so frames from different
 * machines / CI runners still hash to the same value.
 */

const FRAME_LINE_RE = /\s*at\s+(?:(?:[^()]+)\s+\()?([^:]+):(\d+)(?::\d+)?\)?$/;

const SKIP_PATTERNS = [
  /\/node_modules\//,
  /\/playwright(?:-core|-test)?\//,
  /\/@playwright\//,
  /^node:/,
  /^internal\//,
];

export function extractAppCodeFrame(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  for (const rawLine of stack.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('at ')) continue;
    const match = line.match(FRAME_LINE_RE);
    if (!match) continue;
    const [, file, lineNo] = match;
    if (!file) continue;
    if (SKIP_PATTERNS.some((re) => re.test(file))) continue;
    return `${normalizePath(file)}:${lineNo}`;
  }
  return undefined;
}

function normalizePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  // Strip leading absolute path noise so /Users/foo/proj/src/x.ts and
  // /home/runner/work/proj/src/x.ts both collapse to src/x.ts.
  const marker = normalized.lastIndexOf('/src/');
  if (marker !== -1) return normalized.slice(marker + 1);
  const testsMarker = normalized.lastIndexOf('/tests/');
  if (testsMarker !== -1) return normalized.slice(testsMarker + 1);
  const e2eMarker = normalized.lastIndexOf('/e2e/');
  if (e2eMarker !== -1) return normalized.slice(e2eMarker + 1);
  // Fallback: keep the last 3 path segments.
  const segments = normalized.split('/').filter(Boolean);
  return segments.slice(-3).join('/');
}

/**
 * Reads the embedded Playwright report payload (base64 ZIP under
 * `<script id="playwrightReportBase64">` in the merged `index.html`). The
 * per-file JSONs inside carry `errors[].codeframe`, the step tree, stdout/
 * stderr, tags, annotations, and git/CI metadata - richer than the top-level
 * `report.json`. Cached per reportId so prompt builds unzip once.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Open } from 'unzipper';
import { REPORTS_FOLDER } from '../storage/constants.js';
import { stripAnsi } from './failure-extraction.js';

const PAYLOAD_CACHE_TTL_MS = 60_000;
const PAYLOAD_CACHE_MAX_ENTRIES = 16;

export interface ReportJsonMetadata {
  gitCommit?: {
    hash?: string;
    shortHash?: string;
    branch?: string;
    subject?: string;
    body?: string;
    author?: { name?: string; email?: string };
    committer?: { name?: string; email?: string };
    time?: number;
  };
  gitDiff?: string;
  ci?: {
    commitHref?: string;
    commitHash?: string;
    buildHref?: string;
  };
  actualWorkers?: number;
  playwrightVersion?: string;
  [key: string]: unknown;
}

interface ReportJsonStats {
  expected?: number;
  unexpected?: number;
  flaky?: number;
  skipped?: number;
  duration?: number;
  startTime?: string | number;
}

interface ReportJsonFileRef {
  fileId: string;
  fileName?: string;
  tests?: number;
  stats?: ReportJsonStats;
}

interface ReportJson {
  metadata?: ReportJsonMetadata;
  files?: ReportJsonFileRef[];
  projectNames?: string[];
  stats?: ReportJsonStats;
  startTime?: string | number;
  duration?: number;
}

export interface PerFileStep {
  title?: string;
  duration?: number;
  startTime?: string | number;
  location?: { file?: string; line?: number; column?: number };
  count?: number;
  skipped?: boolean;
  attachments?: Array<{ name?: string; path?: string; contentType?: string }>;
  steps?: PerFileStep[];
  /** Present on the step that errored. */
  error?: { message?: string };
  /** Short focused code frame at the failure point (~3 lines). */
  snippet?: string;
}

interface PerFileError {
  message?: string;
  stack?: string;
  /** ±100-line code frame around the failing line with `> NN |` marker and caret. ANSI-coloured in source. */
  codeframe?: string;
  location?: { file?: string; line?: number; column?: number };
}

interface PerFileResult {
  status?: string;
  duration?: number;
  retry?: number;
  startTime?: string | number;
  errors?: PerFileError[];
  steps?: PerFileStep[];
  attachments?: Array<{ name?: string; path?: string; contentType?: string }>;
  stdout?: Array<string | { text?: string }>;
  stderr?: Array<string | { text?: string }>;
}

interface PerFileTest {
  testId: string;
  title?: string;
  path?: string[];
  tags?: string[];
  annotations?: Array<{ type?: string; description?: string }>;
  location?: { file?: string; line?: number; column?: number };
  projectName?: string;
  results?: PerFileResult[];
}

interface PerFileJson {
  fileId: string;
  fileName?: string;
  tests?: PerFileTest[];
}

interface ReportPayload {
  reportJson: ReportJson;
  /** All per-file JSONs in the ZIP, keyed by Playwright fileId. */
  perFile: Map<string, PerFileJson>;
}

interface CacheEntry {
  promise: Promise<ReportPayload | null>;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

const BASE64_PREFIX = 'data:application/zip;base64,';
const BASE64_RE = new RegExp(`${BASE64_PREFIX}([^";\\s]+)(?=[";\\s]|$)`);

async function loadReportPayloadUncached(reportId: string): Promise<ReportPayload | null> {
  const indexPath = path.join(REPORTS_FOLDER, reportId, 'index.html');
  let html: string;
  try {
    html = await fs.readFile(indexPath, 'utf-8');
  } catch {
    return null;
  }

  const match = BASE64_RE.exec(html);
  const base64 = match?.[1]?.trim();
  if (!base64) return null;

  let directory: Awaited<ReturnType<typeof Open.buffer>>;
  try {
    directory = await Open.buffer(Buffer.from(base64, 'base64'));
  } catch {
    return null;
  }

  const reportFile = directory.files.find((f) => f.path === 'report.json');
  if (!reportFile) return null;

  let reportJson: ReportJson;
  try {
    reportJson = JSON.parse((await reportFile.buffer()).toString('utf-8')) as ReportJson;
  } catch {
    return null;
  }

  const perFile = new Map<string, PerFileJson>();
  for (const file of directory.files) {
    if (file.type !== 'File' || !/\.json$/.test(file.path) || file.path === 'report.json') continue;
    try {
      const raw = (await file.buffer()).toString('utf-8');
      const parsed = JSON.parse(raw) as PerFileJson;
      if (parsed && typeof parsed.fileId === 'string') {
        perFile.set(parsed.fileId, parsed);
      }
    } catch {
      // skip individual unparseable per-file JSONs
    }
  }

  return { reportJson, perFile };
}

/**
 * Returns `null` on any failure (missing index.html, malformed base64,
 * unparseable JSON) - callers fall back to DB rows / trace ZIPs. Cache is
 * best-effort (60s TTL, 16-entry cap).
 * The promise is cached so concurrent callers share a single parse;
 * a load that rejects or resolves to `null` is evicted so the next call retries.
 */
export async function loadReportPayload(reportId: string): Promise<ReportPayload | null> {
  const existing = cache.get(reportId);
  if (existing) {
    if (Date.now() < existing.expiresAt) return existing.promise;
    cache.delete(reportId);
  }

  if (cache.size >= PAYLOAD_CACHE_MAX_ENTRIES) {
    // FIFO eviction.
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }

  const promise = loadReportPayloadUncached(reportId);
  const entry: CacheEntry = { promise, expiresAt: Date.now() + PAYLOAD_CACHE_TTL_MS };
  cache.set(reportId, entry);

  promise.then(
    (payload) => {
      if (payload === null && cache.get(reportId) === entry) cache.delete(reportId);
    },
    () => {
      if (cache.get(reportId) === entry) cache.delete(reportId);
    }
  );

  return promise;
}

interface ReportTestSliceTest {
  title?: string;
  path?: string[];
  tags?: string[];
  annotations?: Array<{ type?: string; description?: string }>;
  location?: { file?: string; line?: number; column?: number };
  projectName?: string;
}

interface ReportTestSliceError {
  message?: string;
  stack?: string;
  codeframe?: string;
  location?: { file?: string; line?: number; column?: number };
}

interface ReportTestSlice {
  test: ReportTestSliceTest;
  result: PerFileResult;
  /** Picked error: the one carrying `codeframe`; otherwise the one with the longest message. */
  richestError?: ReportTestSliceError;
  steps?: PerFileStep[];
  stdoutText?: string;
  stderrText?: string;
  attachments?: Array<{ name?: string; path?: string; contentType?: string }>;
  metadata: {
    gitCommit?: ReportJsonMetadata['gitCommit'];
    gitDiff?: string;
    ci?: ReportJsonMetadata['ci'];
  };
}

function joinStdio(entries: PerFileResult['stdout']): string | undefined {
  if (!entries || entries.length === 0) return undefined;
  const parts: string[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string') {
      parts.push(entry);
    } else if (entry && typeof entry.text === 'string') {
      parts.push(entry.text);
    }
  }
  if (parts.length === 0) return undefined;
  const joined = parts.join('');
  const stripped = stripAnsi(joined).trim();
  return stripped.length > 0 ? stripped : undefined;
}

function pickResult(results: PerFileResult[] | undefined): PerFileResult | undefined {
  if (!results || results.length === 0) return undefined;
  // Prefer the first non-passing result (first failed attempt), to match
  // signature reuse across runs. Fall back to the last result when all passed.
  const firstFailed = results.find(
    (r) => r.status && r.status !== 'passed' && r.status !== 'skipped'
  );
  return firstFailed ?? results[results.length - 1];
}

function pickRichestError(errors: PerFileError[] | undefined): ReportTestSliceError | undefined {
  if (!errors || errors.length === 0) return undefined;
  // The richer of two errors on a timeout (the locator failure with the
  // codeframe vs the test-level "Test timeout of Nms exceeded") isn't always
  // errors[0]. Prefer any with a codeframe; otherwise the longest message.
  const withCodeframe = errors.find(
    (e) => typeof e.codeframe === 'string' && e.codeframe.length > 0
  );
  if (withCodeframe) {
    return {
      message: withCodeframe.message ? stripAnsi(withCodeframe.message) : undefined,
      stack: withCodeframe.stack ? stripAnsi(withCodeframe.stack) : undefined,
      codeframe: stripAnsi(withCodeframe.codeframe ?? ''),
      location: withCodeframe.location,
    };
  }
  const longest = [...errors].sort(
    (a, b) => (b.message?.length ?? 0) - (a.message?.length ?? 0)
  )[0];
  return {
    message: longest.message ? stripAnsi(longest.message) : undefined,
    stack: longest.stack ? stripAnsi(longest.stack) : undefined,
    codeframe: undefined,
    location: longest.location,
  };
}

function stripSnippetsInTree(steps: PerFileStep[] | undefined): PerFileStep[] | undefined {
  if (!steps || steps.length === 0) return undefined;
  return steps.map((s) => ({
    ...s,
    snippet: typeof s.snippet === 'string' ? stripAnsi(s.snippet) : undefined,
    error: s.error?.message ? { message: stripAnsi(s.error.message) } : s.error,
    steps: stripSnippetsInTree(s.steps),
  }));
}

/**
 * Walk the per-file JSONs and return the slice for one testId. The picked
 * `result` is the first failed attempt (or the last result when none failed).
 * Returns `null` when the testId is absent.
 */
export function extractFromReportPayload(
  payload: ReportPayload,
  testId: string
): ReportTestSlice | null {
  for (const perFile of payload.perFile.values()) {
    if (!perFile.tests) continue;
    const test = perFile.tests.find((t) => t.testId === testId);
    if (!test) continue;

    const result = pickResult(test.results);
    if (!result) return null;

    const richestError = pickRichestError(result.errors);
    const steps = stripSnippetsInTree(result.steps);
    const stdoutText = joinStdio(result.stdout);
    const stderrText = joinStdio(result.stderr);

    return {
      test: {
        title: test.title,
        path: test.path,
        tags: test.tags,
        annotations: test.annotations,
        location: test.location,
        projectName: test.projectName,
      },
      result,
      richestError,
      steps,
      stdoutText,
      stderrText,
      attachments: result.attachments,
      metadata: {
        gitCommit: payload.reportJson.metadata?.gitCommit,
        gitDiff: payload.reportJson.metadata?.gitDiff,
        ci: payload.reportJson.metadata?.ci,
      },
    };
  }
  return null;
}

/**
 * Single entry point for extracting Playwright failure context. Sources:
 *   - report payload: error, codeframe, steps, stdio, meta
 *   - trace ZIP: console, network, action log, environment
 *   - `error-context` attachment: ARIA page snapshot
 */
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Open } from 'unzipper';
import { REPORTS_FOLDER } from '../storage/constants.js';
import {
  extractFromReportPayload,
  loadReportPayload,
  type PerFileStep,
  type ReportJsonMetadata,
} from './report-payload.js';

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escape sequences requires the ESC control char
const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*m/g;

// Per-message text cap.
const CONSOLE_MAX_TEXT_CHARS = 500;
const CONSOLE_RECENT_LOGS_KEEP = 5;
// Hard cap on total console events
const CONSOLE_MAX_TOTAL = 25;
// Per-request body cap (chars).
const NETWORK_BODY_MAX_CHARS = 1024;
// How many "context" requests to keep around the failure
const NETWORK_PRE_FAILURE_KEEP = 5;
// Hard cap on network events
const NETWORK_MAX_TOTAL = 20;
// Last N actions before the error point.
const ACTION_LOG_KEEP = 10;

/** Header names whose values must be replaced with `[redacted]` before the
 *  evidence is persisted or sent to the LLM. Matched case-insensitively. */
const SENSITIVE_HEADER_PATTERNS: RegExp[] = [
  /^authorization$/i,
  /^proxy-authorization$/i,
  /^cookie$/i,
  /^set-cookie$/i,
  /^x-auth/i,
  /^x-api-key$/i,
  /^x-api-token$/i,
];

export function stripAnsi(s: string): string {
  return s.replace(ANSI_ESCAPE_RE, '');
}

interface AttachmentLike {
  name?: string;
  path?: string;
}

interface ConsoleEvent {
  level: 'error' | 'warning' | 'log' | 'info' | 'debug' | 'trace';
  text: string;
  timestamp?: number;
  location?: { url?: string; lineNumber?: number };
}

interface NetworkEvent {
  method: string;
  url: string;
  status?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  failureText?: string;
  timestamp?: number;
}

interface ActionEvent {
  action: string;
  namespace?: string;
  target?: string;
  startTime?: number;
  endTime?: number;
  error?: string;
}

interface EnvironmentContext {
  browserName?: string;
  browserChannel?: string;
  viewport?: { width: number; height: number };
  baseURL?: string;
  userAgent?: string;
  locale?: string;
  timezone?: string;
  sdkLanguage?: string;
  playwrightVersion?: string;
}

interface TestMeta {
  titlePath?: string[];
  tags?: string[];
  annotations?: Array<{ type?: string; description?: string }>;
}

interface GitCommitInfo {
  hash?: string;
  shortHash?: string;
  branch?: string;
  subject?: string;
}

interface CiBuildInfo {
  buildHref?: string;
  commitHref?: string;
  commitHash?: string;
}

export interface FailureEvidence {
  errorMessage: string;
  stackTrace?: string;
  pageSnapshot?: string;
  testSourceFrame?: string;
  stepTree?: PerFileStep[];
  stdout?: string;
  stderr?: string;
  testMeta?: TestMeta;
  gitCommit?: GitCommitInfo;
  ciBuild?: CiBuildInfo;
  gitDiff?: string;
  consoleEvents: ConsoleEvent[];
  networkEvents: NetworkEvent[];
  actionLog: ActionEvent[];
  environment?: EnvironmentContext;
}

function readErrorContextSync(reportId: string, attachments?: AttachmentLike[]): string {
  if (!attachments) return '';
  for (const att of attachments) {
    if (att.name !== 'error-context' || !att.path) continue;
    try {
      const full = path.join(REPORTS_FOLDER, reportId, att.path);
      const raw = fsSync.readFileSync(full, 'utf-8');
      if (raw) return raw;
    } catch {
      // file may not exist or be unreadable — keep looking
    }
  }
  return '';
}

function sanitizeHeaders(
  headers: Record<string, string> | Array<{ name?: string; value?: string }> | undefined
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const entries: Array<[string, string]> = Array.isArray(headers)
    ? headers
        .filter((h): h is { name: string; value: string } => !!h.name)
        .map((h) => [h.name, h.value ?? ''])
    : Object.entries(headers);
  if (entries.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const [name, value] of entries) {
    out[name] = SENSITIVE_HEADER_PATTERNS.some((p) => p.test(name)) ? '[redacted]' : String(value);
  }
  return out;
}

function truncateBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  let text: string;
  if (typeof body === 'string') {
    text = body;
  } else if (Buffer.isBuffer(body)) {
    text = body.toString('utf-8');
  } else {
    try {
      text = JSON.stringify(body);
    } catch {
      return undefined;
    }
  }
  if (text.length <= NETWORK_BODY_MAX_CHARS) return text;
  const omitted = text.length - NETWORK_BODY_MAX_CHARS;
  return `${text.substring(0, NETWORK_BODY_MAX_CHARS)}\n[… ${omitted} chars omitted …]`;
}

function normalizeConsoleLevel(raw: unknown): ConsoleEvent['level'] {
  const s = typeof raw === 'string' ? raw.toLowerCase() : '';
  switch (s) {
    case 'error':
    case 'warning':
    case 'warn':
      return s === 'warn' ? 'warning' : (s as ConsoleEvent['level']);
    case 'log':
    case 'info':
    case 'debug':
    case 'trace':
      return s;
    default:
      return 'log';
  }
}

/** Accumulators a single trace-line parse appends into. */
interface RawCollectors {
  console: ConsoleEvent[];
  network: Map<string, NetworkEvent>;
  actions: ActionEvent[];
  lastActionEndTime?: number;
  environment?: EnvironmentContext;
}

function collectFromTraceEntry(entry: unknown, c: RawCollectors): void {
  if (!entry || typeof entry !== 'object') return;
  const e = entry as Record<string, unknown>;
  const type = typeof e.type === 'string' ? e.type : undefined;

  // Browser / page context — emitted once near the top of `0-trace.trace`.
  //    Carries browserName + page options (viewport, locale, baseURL, ...).
  if (type === 'context-options') {
    const opts = (e.options as Record<string, unknown> | undefined) ?? {};
    const viewport = opts.viewport as { width?: number; height?: number } | undefined;
    const browserName = typeof e.browserName === 'string' ? e.browserName : undefined;
    const channel = typeof opts.channel === 'string' ? opts.channel : undefined;
    c.environment = {
      browserName,
      browserChannel: channel && channel !== browserName ? channel : undefined,
      viewport:
        viewport && typeof viewport.width === 'number' && typeof viewport.height === 'number'
          ? { width: viewport.width, height: viewport.height }
          : undefined,
      baseURL: typeof opts.baseURL === 'string' ? opts.baseURL : undefined,
      userAgent: typeof opts.userAgent === 'string' ? opts.userAgent : undefined,
      locale: typeof opts.locale === 'string' ? opts.locale : undefined,
      timezone: typeof opts.timezoneId === 'string' ? opts.timezoneId : undefined,
      sdkLanguage: typeof e.sdkLanguage === 'string' ? e.sdkLanguage : undefined,
    };
    return;
  }

  // Console messages. Modern traces emit `type:'console'`; older ones wrap
  //    them in `type:'event'` with `method:'console.message'`.
  if (
    type === 'console' ||
    (type === 'event' && typeof e.method === 'string' && e.method.toLowerCase().includes('console'))
  ) {
    const text =
      typeof e.text === 'string'
        ? e.text
        : typeof (e.params as { text?: string } | undefined)?.text === 'string'
          ? (e.params as { text: string }).text
          : '';
    if (!text) return;
    const levelRaw =
      e.messageType ?? (e.params as { messageType?: string } | undefined)?.messageType;
    const loc = (e.location ?? (e.params as { location?: unknown } | undefined)?.location) as
      | { url?: string; lineNumber?: number }
      | undefined;
    c.console.push({
      level: normalizeConsoleLevel(levelRaw),
      text,
      timestamp: typeof e.timestamp === 'number' ? e.timestamp : undefined,
      location:
        loc && (loc.url || typeof loc.lineNumber === 'number')
          ? { url: loc.url, lineNumber: loc.lineNumber }
          : undefined,
    });
    return;
  }

  // Resource (network) events. Modern shape: a single entry with method/url/status.
  //    `type:'resource-snapshot'` is a DOM-resource entry and is NOT a network call —
  //    skip it. The dedicated `*.network` file uses `type:'resource'` with a
  //    `_monotonicTime` (or `timestamp`) ordering field.
  if (type === 'resource' || type === 'resourceSnapshot' || type === 'resourceFinished') {
    if (type === 'resourceSnapshot') return; // not a network call
    const url = typeof e.url === 'string' ? e.url : '';
    if (!url) return;
    const method = typeof e.method === 'string' ? e.method : 'GET';
    const status = typeof e.status === 'number' ? e.status : undefined;
    const key = `${method} ${url} ${typeof e.timestamp === 'number' ? e.timestamp : ''}`;
    const existing = c.network.get(key);
    const event: NetworkEvent = {
      method,
      url,
      status,
      requestHeaders: sanitizeHeaders(
        e.requestHeaders as Record<string, string> | Array<{ name?: string; value?: string }>
      ),
      responseHeaders: sanitizeHeaders(
        e.responseHeaders as Record<string, string> | Array<{ name?: string; value?: string }>
      ),
      requestBody: truncateBody(e.requestBody),
      responseBody: truncateBody(e.responseBody),
      failureText: typeof e.failureText === 'string' ? e.failureText : undefined,
      timestamp:
        typeof e.timestamp === 'number'
          ? e.timestamp
          : typeof e._monotonicTime === 'number'
            ? (e._monotonicTime as number)
            : undefined,
    };
    c.network.set(key, { ...existing, ...event });
    return;
  }

  // Action entries — `before` (start) + `after` (end, sometimes with error).
  //    Modern shape: a single `type:'action'` entry. We carry the latest
  //    end-time-of-an-action so prioritization can use it as the failure anchor.
  //    Error message + stack are NOT pulled from the trace — those live in
  //    the report payload (`result.errors[]`), which is the canonical source.
  if (type === 'before' || type === 'action') {
    const title = typeof e.title === 'string' && e.title.trim() ? e.title.trim() : undefined;
    const method =
      typeof e.method === 'string'
        ? e.method
        : typeof (e.params as { method?: string } | undefined)?.method === 'string'
          ? (e.params as { method: string }).method
          : typeof e.apiName === 'string'
            ? e.apiName
            : 'unknown';
    const klass = typeof e.class === 'string' ? e.class : undefined;
    const selector =
      typeof (e.params as { selector?: string } | undefined)?.selector === 'string'
        ? (e.params as { selector: string }).selector
        : typeof (e.params as { url?: string } | undefined)?.url === 'string'
          ? (e.params as { url: string }).url
          : typeof (e.params as { text?: string } | undefined)?.text === 'string'
            ? (e.params as { text: string }).text
            : undefined;
    c.actions.push({
      action: title || method,
      target: selector,
      namespace: klass,
      startTime: typeof e.startTime === 'number' ? e.startTime : undefined,
      endTime: typeof e.endTime === 'number' ? e.endTime : undefined,
    });
    if (typeof e.endTime === 'number') {
      c.lastActionEndTime = Math.max(c.lastActionEndTime ?? 0, e.endTime);
    }
    return;
  }
  if (type === 'after') {
    const errorMsg =
      typeof (e.error as { message?: string } | undefined)?.message === 'string'
        ? (e.error as { message: string }).message
        : undefined;
    if (errorMsg && c.actions.length > 0) {
      c.actions[c.actions.length - 1].error = errorMsg;
    }
    if (typeof e.endTime === 'number') {
      c.lastActionEndTime = Math.max(c.lastActionEndTime ?? 0, e.endTime);
    }
  }
}

/** Read every `*.trace` and `*.network` JSONL entry in the trace ZIP. */
async function collectFromTraceZip(
  directory: Awaited<ReturnType<typeof Open.buffer>>
): Promise<RawCollectors> {
  const collectors: RawCollectors = { console: [], network: new Map(), actions: [] };
  const files = directory.files.filter(
    (f) => f.type === 'File' && /\.(trace|network)$/.test(f.path)
  );
  for (const file of files) {
    let content: string;
    try {
      content = (await file.buffer()).toString('utf-8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        collectFromTraceEntry(JSON.parse(trimmed), collectors);
      } catch {
        // skip unparseable lines — trace files are best-effort JSONL
      }
    }
  }
  return collectors;
}

function prioritizeConsole(events: ConsoleEvent[]): ConsoleEvent[] {
  if (events.length === 0) return events;
  const sorted = [...events].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const errorsAndWarnings: ConsoleEvent[] = [];
  const others: ConsoleEvent[] = [];
  for (const ev of sorted) {
    (ev.level === 'error' || ev.level === 'warning' ? errorsAndWarnings : others).push(ev);
  }
  const kept = [...errorsAndWarnings, ...others.slice(-CONSOLE_RECENT_LOGS_KEEP)];
  const truncated = kept.map((ev) => ({
    ...ev,
    text:
      ev.text.length > CONSOLE_MAX_TEXT_CHARS
        ? `${ev.text.substring(0, CONSOLE_MAX_TEXT_CHARS)}…`
        : ev.text,
  }));
  if (truncated.length <= CONSOLE_MAX_TOTAL) return truncated;
  const errs = truncated.filter((e) => e.level === 'error' || e.level === 'warning');
  const oth = truncated.filter((e) => e.level !== 'error' && e.level !== 'warning');
  const errBudget = Math.min(errs.length, CONSOLE_MAX_TOTAL - Math.min(oth.length, 5));
  return [...errs.slice(-errBudget), ...oth.slice(-(CONSOLE_MAX_TOTAL - errBudget))];
}

function prioritizeNetwork(events: NetworkEvent[], anchorTime?: number): NetworkEvent[] {
  if (events.length === 0) return events;
  const sorted = [...events].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const isFailed = (ev: NetworkEvent) =>
    !!ev.failureText || (typeof ev.status === 'number' && ev.status >= 400);
  const failed = sorted.filter(isFailed);
  const successes = sorted.filter((ev) => !isFailed(ev));
  const beforeAnchor =
    anchorTime !== undefined
      ? successes.filter((ev) => (ev.timestamp ?? 0) <= anchorTime)
      : successes;
  const contextSuccesses = beforeAnchor.slice(-NETWORK_PRE_FAILURE_KEEP);
  const merged = [...failed, ...contextSuccesses].sort(
    (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)
  );
  if (merged.length <= NETWORK_MAX_TOTAL) return merged;
  const failedKeep = Math.min(failed.length, NETWORK_MAX_TOTAL);
  return [
    ...failed.slice(-failedKeep),
    ...contextSuccesses.slice(-(NETWORK_MAX_TOTAL - failedKeep)),
  ].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}

// Framework-marker action names that carry no actionable detail.
const ACTION_FRAMEWORK_MARKERS = new Set(['hook', 'fixture', 'test.step']);

function isNoiseAction(a: ActionEvent): boolean {
  if (a.error) return false;
  if (a.target) return false;
  return ACTION_FRAMEWORK_MARKERS.has(a.action.toLowerCase());
}

function prioritizeActions(actions: ActionEvent[]): ActionEvent[] {
  if (actions.length === 0) return actions;
  // Drop framework-marker entries (`hook`/`fixture`/`test.step` with no
  // target and no error)
  const filtered = actions.filter((a) => !isNoiseAction(a));
  if (filtered.length === 0) return filtered;
  const erroredIdx = filtered.findIndex((a) => !!a.error);
  if (erroredIdx === -1) return filtered.slice(-ACTION_LOG_KEEP);
  const start = Math.max(0, erroredIdx - ACTION_LOG_KEEP + 1);
  return filtered.slice(start, erroredIdx + 1);
}

/** Read console + network + action + environment context from a Playwright trace ZIP. */
async function extractEvidenceFromTrace(
  reportId: string,
  tracePath: string
): Promise<{
  consoleEvents: ConsoleEvent[];
  networkEvents: NetworkEvent[];
  actionLog: ActionEvent[];
  environment?: EnvironmentContext;
} | null> {
  try {
    const reportDir = path.join(REPORTS_FOLDER, reportId);
    const zipBuffer = await fs.readFile(path.join(reportDir, tracePath));
    const directory = await Open.buffer(zipBuffer);
    const collectors = await collectFromTraceZip(directory);
    return {
      consoleEvents: prioritizeConsole(collectors.console),
      networkEvents: prioritizeNetwork(
        Array.from(collectors.network.values()),
        collectors.lastActionEndTime
      ),
      actionLog: prioritizeActions(collectors.actions),
      environment: collectors.environment,
    };
  } catch (error) {
    console.error(`[failure-extraction] Failed to read trace ${tracePath}:`, error);
    return null;
  }
}

function splitMessageAndStack(raw: string): { message: string; stack?: string } {
  const cleaned = stripAnsi(raw);
  if (!cleaned) return { message: '' };
  const stackIndex = cleaned.indexOf('\n    at ');
  if (stackIndex > 0) {
    return { message: cleaned.substring(0, stackIndex), stack: cleaned.substring(stackIndex) };
  }
  return { message: cleaned };
}

function metadataToGitCommit(
  meta: ReportJsonMetadata['gitCommit'] | undefined
): GitCommitInfo | undefined {
  if (!meta) return undefined;
  const info: GitCommitInfo = {
    hash: meta.hash,
    shortHash: meta.shortHash,
    branch: meta.branch,
    subject: meta.subject,
  };
  return Object.values(info).some((v) => typeof v === 'string' && v.length > 0) ? info : undefined;
}

function metadataToCiBuild(meta: ReportJsonMetadata['ci'] | undefined): CiBuildInfo | undefined {
  if (!meta) return undefined;
  const info: CiBuildInfo = {
    buildHref: meta.buildHref,
    commitHref: meta.commitHref,
    commitHash: meta.commitHash,
  };
  return Object.values(info).some((v) => typeof v === 'string' && v.length > 0) ? info : undefined;
}

function buildTestMeta(slice: {
  test: {
    path?: string[];
    tags?: string[];
    annotations?: Array<{ type?: string; description?: string }>;
  };
}): TestMeta | undefined {
  const titlePath = slice.test.path && slice.test.path.length > 0 ? slice.test.path : undefined;
  const tags = slice.test.tags && slice.test.tags.length > 0 ? slice.test.tags : undefined;
  const annotations =
    slice.test.annotations && slice.test.annotations.length > 0
      ? slice.test.annotations
      : undefined;
  if (!titlePath && !tags && !annotations) return undefined;
  return { titlePath, tags, annotations };
}

/**
 * Best-effort full-evidence extraction for one failed test attempt. Source:
 *   - Error message, stack, code frame, step tree, stdout/stderr, test meta,
 *     git commit, git diff, CI build links → embedded report payload
 *     (`script#playwrightReportBase64`).
 *   - Console events, network events, action log, environment → trace ZIP.
 *   - Page snapshot → `error-context` attachment.
 */
export async function extractFailureEvidence(
  reportId: string,
  test: { testId?: string; title?: string; outcome?: string },
  result: {
    status?: string;
    message?: string;
    attachments?: Array<{ name?: string; path?: string; contentType?: string }>;
  }
): Promise<FailureEvidence> {
  let testSourceFrame: string | undefined;
  let stepTree: PerFileStep[] | undefined;
  let stdoutText: string | undefined;
  let stderrText: string | undefined;
  let testMeta: TestMeta | undefined;
  let gitCommit: GitCommitInfo | undefined;
  let ciBuild: CiBuildInfo | undefined;
  let gitDiff: string | undefined;

  // Payload-derived fields. The richest error here wins for message/stack
  //    because the trace no longer owns the canonical error path.
  let payloadMessage: string | undefined;
  let payloadStack: string | undefined;
  if (test.testId) {
    const payload = await loadReportPayload(reportId);
    if (payload) {
      const slice = extractFromReportPayload(payload, test.testId);
      if (slice) {
        if (slice.richestError?.message) {
          payloadMessage = slice.richestError.message;
          payloadStack = slice.richestError.stack;
        }
        testSourceFrame = slice.richestError?.codeframe || undefined;
        stepTree = slice.steps;
        stdoutText = slice.stdoutText;
        stderrText = slice.stderrText;
        testMeta = buildTestMeta(slice);
        gitCommit = metadataToGitCommit(slice.metadata.gitCommit);
        ciBuild = metadataToCiBuild(slice.metadata.ci);
        gitDiff = slice.metadata.gitDiff;
      }
    }
  }

  // Error message / stack: payload wins; fall back to result.message
  //    (split into message + stack when concatenated), finally synthetic.
  let message = payloadMessage ?? '';
  let stackTrace = payloadStack;
  if (!message) {
    const split = splitMessageAndStack(result.message ?? '');
    message = split.message;
    if (!stackTrace) stackTrace = split.stack;
  }

  // Trace ZIP — console + network + action + environment only.
  let consoleEvents: ConsoleEvent[] = [];
  let networkEvents: NetworkEvent[] = [];
  let actionLog: ActionEvent[] = [];
  let environment: EnvironmentContext | undefined;
  const traceAtt = result.attachments?.find((a) => a.name === 'trace' && a.path);
  if (traceAtt?.path) {
    const evidence = await extractEvidenceFromTrace(reportId, traceAtt.path);
    if (evidence) {
      consoleEvents = evidence.consoleEvents;
      networkEvents = evidence.networkEvents;
      actionLog = evidence.actionLog;
      environment = evidence.environment;
    }
  }

  const pageSnapshot = readErrorContextSync(reportId, result.attachments) || undefined;

  if (!message) {
    message = `Test ${test.outcome ?? result.status ?? 'failed'}: ${test.title ?? 'Unknown Test'}`;
  }

  return {
    errorMessage: message,
    stackTrace,
    pageSnapshot,
    testSourceFrame,
    stepTree,
    stdout: stdoutText,
    stderr: stderrText,
    testMeta,
    gitCommit,
    ciBuild,
    gitDiff,
    consoleEvents,
    networkEvents,
    actionLog,
    environment,
  };
}

/**
 * Single entry point for extracting Playwright failure context. Source routing:
 *   - report payload (`report-payload.ts`): error, codeframe, steps, stdio, meta
 *   - trace ZIP: console, network, action log, environment
 *   - `error-context` attachment: ARIA page snapshot (read whole)
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

/** Per-message text cap. Console output is often huge (stringified objects,
 *  stack traces). 500 chars is enough to identify the error shape without
 *  drowning the prompt. */
const CONSOLE_MAX_TEXT_CHARS = 500;
/** How many trailing log/info/debug messages to keep alongside ALL
 *  error/warning messages. Anything older than the last 5 is dropped. */
const CONSOLE_RECENT_LOGS_KEEP = 5;
/** Hard cap on total console events surfaced to the prompt — guards against
 *  pages that log thousands of warnings per run. */
const CONSOLE_MAX_TOTAL = 25;

/** Per-request body cap (chars). Bigger bodies are truncated with a marker. */
const NETWORK_BODY_MAX_CHARS = 1024;
/** How many "context" requests to keep around the failure: the last-N
 *  successful requests immediately before the failure point. */
const NETWORK_PRE_FAILURE_KEEP = 5;
/** Hard cap on network events surfaced to the prompt. Failed/non-2xx always
 *  win the budget; successful "context" requests fill remaining slots. */
const NETWORK_MAX_TOTAL = 20;

/** Last N actions before the error point. */
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
  /** Normalized level — Playwright emits `messageType` like 'error'|'warning'|'log'|'info'|'debug'|'trace'. */
  level: 'error' | 'warning' | 'log' | 'info' | 'debug' | 'trace';
  text: string;
  /** Monotonic trace timestamp. Order-only meaning; not wall-clock. */
  timestamp?: number;
  location?: { url?: string; lineNumber?: number };
}

interface NetworkEvent {
  method: string;
  url: string;
  /** HTTP status code when a response was received. Absent on failed/aborted requests. */
  status?: number;
  /** Sanitized request headers (Authorization/Cookie/etc. replaced with `[redacted]`). */
  requestHeaders?: Record<string, string>;
  /** Sanitized response headers. */
  responseHeaders?: Record<string, string>;
  /** Truncated request body. */
  requestBody?: string;
  /** Truncated response body. */
  responseBody?: string;
  /** Error text from the transport layer (DNS, TLS, abort). */
  failureText?: string;
  timestamp?: number;
}

interface ActionEvent {
  /** Action label — prefers the trace's human-readable `title` (e.g.
   *  "Click getByRole('button', { name: 'Insert' })") and falls back to the
   *  raw `method`/`apiName` (e.g. 'click', 'goto', 'hook'). */
  action: string;
  /** Namespace hint from the trace's `class` field — e.g. 'Locator', 'Page',
   *  'Test'. Helps the prompt distinguish a real user action from a framework
   *  marker (hook / fixture / test.step). */
  namespace?: string;
  /** Selector, URL, or other primary parameter — kept compact for the prompt. */
  target?: string;
  startTime?: number;
  endTime?: number;
  /** Error text when the action itself failed (vs. an assertion later). */
  error?: string;
}

interface EnvironmentContext {
  /** Engine name: 'chromium' | 'firefox' | 'webkit'. */
  browserName?: string;
  /** Browser channel ('chrome', 'msedge', etc.) when distinct from the engine. */
  browserChannel?: string;
  viewport?: { width: number; height: number };
  baseURL?: string;
  userAgent?: string;
  /** Locale of the browser context, e.g. 'en-US'. */
  locale?: string;
  /** Time zone of the browser context, e.g. 'Europe/Berlin'. */
  timezone?: string;
  /** Playwright SDK language: 'javascript' | 'python' | 'java' | 'csharp'. */
  sdkLanguage?: string;
  /** Playwright version from the report metadata, not the trace. */
  playwrightVersion?: string;
}

interface TestMeta {
  /** Suite hierarchy from `test.path` — e.g. `["Text styles", "Callout"]`. */
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
  /** Canonical error message. Prefers the report payload's richest error,
   *  falls back to result.message, finally to a synthetic "Test {outcome}: {title}". */
  errorMessage: string;
  stackTrace?: string;
  /** Page ARIA snapshot from the `error-context` attachment. Read whole — no
   *  truncation, since input budgets are not the bottleneck and snapshots for
   *  complex pages routinely exceed 4 KB. */
  pageSnapshot?: string;
  /** ±100-line code frame around the failing line, from the report payload's
   *  `errors[].codeframe`. ANSI-stripped, line numbers and `>` marker preserved. */
  testSourceFrame?: string;
  /** Full nested `result.steps[]` tree from the report payload. The errored
   *  step carries `error` + `snippet`; the prompt builder walks the tree to
   *  render the indented step list. */
  stepTree?: PerFileStep[];
  /** Joined `result.stdout` array from the report payload. ANSI-stripped. */
  stdout?: string;
  /** Joined `result.stderr` array from the report payload. ANSI-stripped. */
  stderr?: string;
  /** Suite path, tags, and annotations from the per-file test entry. */
  testMeta?: TestMeta;
  /** Git commit metadata from `report.metadata.gitCommit`. */
  gitCommit?: GitCommitInfo;
  /** CI build / commit links from `report.metadata.ci`. */
  ciBuild?: CiBuildInfo;
  /** `report.metadata.gitDiff` — present when Playwright captured a diff. */
  gitDiff?: string;
  /** Console events ordered by timestamp — all errors/warnings + last N logs. */
  consoleEvents: ConsoleEvent[];
  /** Network events — all failed/non-2xx + a few successful ones immediately before the failure. */
  networkEvents: NetworkEvent[];
  /** Last actions Playwright executed before the error point. */
  actionLog: ActionEvent[];
  /** Browser / page environment captured from the trace's `context-options`
   *  entry. `playwrightVersion` is filled in by the caller from the report
   *  metadata since traces don't carry it. */
  environment?: EnvironmentContext;
}

/**
 * Synchronously read the `error-context` attachment file in full. Returns ''
 * when no such attachment exists or the file is missing/unreadable. Note: not
 * truncated — observed prompts run 4–8 k input tokens, well within budget, and
 * complex-page ARIA snapshots routinely exceed 4 KB.
 */
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

/**
 * Parse a single JSONL line from a trace file and dispatch into the right
 * collector. Returns false for unrecognized shapes so the caller can skip.
 *
 * Trace versions vary across Playwright releases; we recognize multiple
 * shapes for each event type rather than locking onto one schema.
 */
interface RawCollectors {
  console: ConsoleEvent[];
  network: Map<string, NetworkEvent>;
  actions: ActionEvent[];
  /** Highest action endTime seen — used as the "failure time" anchor when no
   *  explicit error timestamp is available. */
  lastActionEndTime?: number;
  environment?: EnvironmentContext;
}

function collectFromTraceEntry(entry: unknown, c: RawCollectors): void {
  if (!entry || typeof entry !== 'object') return;
  const e = entry as Record<string, unknown>;
  const type = typeof e.type === 'string' ? e.type : undefined;

  // 0. Browser / page context — emitted once near the top of `0-trace.trace`.
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

  // 1. Console messages. Modern traces emit `type:'console'`; older ones wrap
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

  // 2. Resource (network) events. Modern shape: a single entry with method/url/status.
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

  // 3. Action entries — `before` (start) + `after` (end, sometimes with error).
  //    Modern shape: a single `type:'action'` entry. We carry the latest
  //    end-time-of-an-action so prioritization can use it as the failure anchor.
  //    Error message + stack are NOT pulled from the trace — those live in
  //    the report payload (`result.errors[]`), which is the canonical source.
  if (type === 'before' || type === 'action') {
    // Prefer the human-readable `title` (Playwright trace UI label, e.g.
    // "Click getByRole('button', { name: 'Insert' })") over raw `method`/
    // `apiName` (which often resolve to opaque categories like "hook" or
    // "pw:api"). `class` (Locator / Page / Test) is captured separately as a
    // namespace hint for the renderer.
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
    // Attach an error to the most recent action when present — used to mark
    // the errored entry in `actionLog`, not as the canonical error source.
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

/**
 * Read every `*.trace` and `*.network` JSONL entry in the trace ZIP. Trace
 * versions split events across files differently across Playwright releases,
 * so we walk all of them and dispatch by entry type.
 */
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
  // Sort by timestamp (when present); entries without a timestamp keep insertion order.
  const sorted = [...events].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const errorsAndWarnings: ConsoleEvent[] = [];
  const others: ConsoleEvent[] = [];
  for (const ev of sorted) {
    (ev.level === 'error' || ev.level === 'warning' ? errorsAndWarnings : others).push(ev);
  }
  // Keep ALL errors+warnings; trim others to the last N.
  const kept = [...errorsAndWarnings, ...others.slice(-CONSOLE_RECENT_LOGS_KEEP)];
  // Apply per-message truncation + global cap (latest-error wins on overflow).
  const truncated = kept.map((ev) => ({
    ...ev,
    text:
      ev.text.length > CONSOLE_MAX_TEXT_CHARS
        ? `${ev.text.substring(0, CONSOLE_MAX_TEXT_CHARS)}…`
        : ev.text,
  }));
  if (truncated.length <= CONSOLE_MAX_TOTAL) return truncated;
  // Overflow: keep the most recent errors/warnings + tail of others. Errors win.
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
  // Successful requests just before the failure anchor (or the tail of the timeline
  // when no anchor is known) are useful context — they show what page state
  // existed at the moment of failure.
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
  // Overflow: failed wins; trim trailing successes.
  const failedKeep = Math.min(failed.length, NETWORK_MAX_TOTAL);
  return [
    ...failed.slice(-failedKeep),
    ...contextSuccesses.slice(-(NETWORK_MAX_TOTAL - failedKeep)),
  ].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}

/** Framework-marker action names that carry no actionable detail. The step
 *  tree (rendered separately from the report payload) already shows the
 *  hook/fixture/step hierarchy with proper titles; the trace-derived action
 *  log doesn't need to repeat them noisily. */
const ACTION_FRAMEWORK_MARKERS = new Set(['hook', 'fixture', 'test.step']);

function isNoiseAction(a: ActionEvent): boolean {
  if (a.error) return false;
  if (a.target) return false;
  return ACTION_FRAMEWORK_MARKERS.has(a.action.toLowerCase());
}

function prioritizeActions(actions: ActionEvent[]): ActionEvent[] {
  if (actions.length === 0) return actions;
  // Drop framework-marker entries (`hook`/`fixture`/`test.step` with no
  // target and no error) — the step tree already covers them and they add
  // no diagnostic signal to the action log. Keep them when they DO carry an
  // error (the errored entry stays so the renderer can mark the failure
  // point).
  const filtered = actions.filter((a) => !isNoiseAction(a));
  if (filtered.length === 0) return filtered;
  // The action that errored (if any) plus the last N actions before it.
  const erroredIdx = filtered.findIndex((a) => !!a.error);
  if (erroredIdx === -1) return filtered.slice(-ACTION_LOG_KEEP);
  const start = Math.max(0, erroredIdx - ACTION_LOG_KEEP + 1);
  return filtered.slice(start, erroredIdx + 1);
}

/**
 * Read console + network + action + environment context from a Playwright
 * trace ZIP. Heavyweight (decompresses + walks JSONL); call only for failed
 * attempts. The trace ZIP no longer owns error message / stack — those come
 * from the report payload.
 */
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
 * Best-effort full-evidence extraction for one failed test attempt. Source
 * routing:
 *   - Error message, stack, code frame, step tree, stdout/stderr, test meta,
 *     git commit, git diff, CI build links → embedded report payload
 *     (`script#playwrightReportBase64`).
 *   - Console events, network events, action log, environment → trace ZIP.
 *   - Page snapshot → `error-context` attachment.
 *
 * `testId` enables the report-payload lookup; when absent (or the payload is
 * malformed / missing), all payload-derived fields stay `undefined` and the
 * builder omits the corresponding segments. `errorMessage` still falls back
 * to `result.message` → synthetic so signature grouping keeps working.
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

  // 1. Payload-derived fields. The richest error here wins for message/stack
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

  // 2. Error message / stack: payload wins; fall back to result.message
  //    (split into message + stack when concatenated), finally synthetic.
  let message = payloadMessage ?? '';
  let stackTrace = payloadStack;
  if (!message) {
    const split = splitMessageAndStack(result.message ?? '');
    message = split.message;
    if (!stackTrace) stackTrace = split.stack;
  }

  // 3. Trace ZIP — console + network + action + environment only.
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

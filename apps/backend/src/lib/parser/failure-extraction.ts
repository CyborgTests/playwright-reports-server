/**
 * Shared helpers for extracting Playwright failure context from on-disk reports.
 *
 * Why this exists: the merged-blob `report.json` format frequently leaves
 * `result.message` empty. The actual error text — plus everything the LLM
 * needs for a useful root-cause diagnosis — lives in attachment files:
 *
 *   - `error-context` — markdown DOM snapshot (Playwright's "Copy prompt" source).
 *     Useful for LLM context but doesn't contain the error string itself.
 *   - `trace` — ZIP containing `*.trace` and `*.network` JSONL files. Carries
 *     the structured error entry (canonical error source), console events,
 *     network requests/responses, and the action log.
 *
 * Both the upload-time heuristic (testManagement.processReport) and the LLM
 * analysis queue read this through the same `extractFailureEvidence` entry
 * point so the prompt sees the same evidence regardless of which code path
 * produced it.
 */
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import JSZip from 'jszip';
import { REPORTS_FOLDER } from '../storage/constants.js';

const ERROR_CONTEXT_MAX_CHARS = 4000;
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

export interface ConsoleEvent {
  /** Normalized level — Playwright emits `messageType` like 'error'|'warning'|'log'|'info'|'debug'|'trace'. */
  level: 'error' | 'warning' | 'log' | 'info' | 'debug' | 'trace';
  text: string;
  /** Monotonic trace timestamp. Order-only meaning; not wall-clock. */
  timestamp?: number;
  location?: { url?: string; lineNumber?: number };
}

export interface NetworkEvent {
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

export interface ActionEvent {
  /** Action name like 'click', 'fill', 'goto', 'expect.toBeVisible'. */
  action: string;
  /** Selector, URL, or other primary parameter — kept compact for the prompt. */
  target?: string;
  startTime?: number;
  endTime?: number;
  /** Error text when the action itself failed (vs. an assertion later). */
  error?: string;
}

export interface EnvironmentContext {
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

export interface FailureEvidence {
  /** Canonical error message. Prefers trace's structured error, falls back to
   *  result.message, finally to a synthetic "Test {outcome}: {title}". */
  errorMessage: string;
  stackTrace?: string;
  /** DOM snapshot from the `error-context` attachment, truncated to ERROR_CONTEXT_MAX_CHARS. */
  pageSnapshot?: string;
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
 * Synchronously read the `error-context` attachment file (truncated to
 * ERROR_CONTEXT_MAX_CHARS). Returns '' when no such attachment exists or the
 * file is missing/unreadable.
 */
function readErrorContextSync(reportId: string, attachments?: AttachmentLike[]): string {
  if (!attachments) return '';
  for (const att of attachments) {
    if (att.name !== 'error-context' || !att.path) continue;
    try {
      const full = path.join(REPORTS_FOLDER, reportId, att.path);
      const raw = fsSync.readFileSync(full, 'utf-8');
      if (!raw) continue;
      return raw.length > ERROR_CONTEXT_MAX_CHARS
        ? `${raw.substring(0, ERROR_CONTEXT_MAX_CHARS)}\n\n... (truncated)`
        : raw;
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
  error?: { message: string; stack: string };
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
  if (type === 'before' || type === 'action') {
    const action =
      typeof e.method === 'string'
        ? e.method
        : typeof (e.params as { method?: string } | undefined)?.method === 'string'
          ? (e.params as { method: string }).method
          : typeof e.apiName === 'string'
            ? e.apiName
            : 'unknown';
    const selector =
      typeof (e.params as { selector?: string } | undefined)?.selector === 'string'
        ? (e.params as { selector: string }).selector
        : typeof (e.params as { url?: string } | undefined)?.url === 'string'
          ? (e.params as { url: string }).url
          : undefined;
    c.actions.push({
      action,
      target: selector,
      startTime: typeof e.startTime === 'number' ? e.startTime : undefined,
      endTime: typeof e.endTime === 'number' ? e.endTime : undefined,
    });
    if (typeof e.endTime === 'number') {
      c.lastActionEndTime = Math.max(c.lastActionEndTime ?? 0, e.endTime);
    }
    return;
  }
  if (type === 'after') {
    // Attach an error to the most recent action when present.
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
    return;
  }

  // 4. Top-level error entries — used as the canonical error message + stack.
  if (type === 'error' && typeof e.message === 'string' && e.message && !c.error) {
    const stackLines = Array.isArray(e.stack)
      ? (e.stack as Array<{ file?: string; line?: number; column?: number; function?: string }>)
          .map(
            (s) =>
              `    at ${s.function ? `${s.function} ` : ''}(${s.file ?? ''}:${s.line ?? ''}:${s.column ?? ''})`
          )
          .join('\n')
      : typeof e.stack === 'string'
        ? e.stack
        : '';
    c.error = { message: e.message, stack: stackLines };
    return;
  }
  if (type === 'after' && !c.error) {
    const err = e.error as { message?: string; stack?: unknown } | undefined;
    if (err?.message) {
      c.error = {
        message: err.message,
        stack: typeof err.stack === 'string' ? err.stack : '',
      };
    }
  }
}

/**
 * Read every `*.trace` and `*.network` JSONL entry in the trace ZIP. Trace
 * versions split events across files differently across Playwright releases,
 * so we walk all of them and dispatch by entry type.
 */
async function collectFromTraceZip(zip: JSZip): Promise<RawCollectors> {
  const collectors: RawCollectors = { console: [], network: new Map(), actions: [] };
  const files = zip.file(/\.(trace|network)$/);
  for (const file of files) {
    let content: string;
    try {
      content = await file.async('string');
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

function prioritizeActions(actions: ActionEvent[]): ActionEvent[] {
  if (actions.length === 0) return actions;
  // The action that errored (if any) plus the last N actions before it.
  const erroredIdx = actions.findIndex((a) => !!a.error);
  if (erroredIdx === -1) return actions.slice(-ACTION_LOG_KEEP);
  const start = Math.max(0, erroredIdx - ACTION_LOG_KEEP + 1);
  return actions.slice(start, erroredIdx + 1);
}

/**
 * Read the full evidence payload from a Playwright trace ZIP — error, console,
 * network, action log. Heavyweight (decompresses + walks JSONL); call only
 * for failed-test attempts.
 */
async function extractEvidenceFromTrace(
  reportId: string,
  tracePath: string
): Promise<{
  error: { message: string; stack: string } | null;
  consoleEvents: ConsoleEvent[];
  networkEvents: NetworkEvent[];
  actionLog: ActionEvent[];
  environment?: EnvironmentContext;
} | null> {
  try {
    const reportDir = path.join(REPORTS_FOLDER, reportId);
    const zipBuffer = await fs.readFile(path.join(reportDir, tracePath));
    const zip = await JSZip.loadAsync(zipBuffer);
    const collectors = await collectFromTraceZip(zip);
    return {
      error: collectors.error ?? null,
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

/**
 * Best-effort full-evidence extraction for one failed test attempt. Combines:
 *   - `result.message` (split into message + stack when concatenated)
 *   - the trace ZIP's structured error entry (canonical when present)
 *   - the `error-context` attachment (DOM snapshot, surfaced as `pageSnapshot`)
 *   - console + network + action events from the trace
 *
 * `errorMessage` falls back to a synthetic "Test {outcome}: {title}" so
 * signature grouping still works even when no error source is recoverable.
 */
export async function extractFailureEvidence(
  reportId: string,
  test: { title?: string; outcome?: string },
  result: {
    status?: string;
    message?: string;
    attachments?: Array<{ name?: string; path?: string; contentType?: string }>;
  }
): Promise<FailureEvidence> {
  let message = stripAnsi(result.message ?? '');
  let stackTrace: string | undefined;

  // Some Playwright versions concatenate the stack onto the message — split.
  if (message) {
    const stackIndex = message.indexOf('\n    at ');
    if (stackIndex > 0) {
      stackTrace = message.substring(stackIndex);
      message = message.substring(0, stackIndex);
    }
  }

  let consoleEvents: ConsoleEvent[] = [];
  let networkEvents: NetworkEvent[] = [];
  let actionLog: ActionEvent[] = [];
  let environment: EnvironmentContext | undefined;

  const traceAtt = result.attachments?.find((a) => a.name === 'trace' && a.path);
  if (traceAtt?.path) {
    const evidence = await extractEvidenceFromTrace(reportId, traceAtt.path);
    if (evidence) {
      if (evidence.error?.message) {
        const cleaned = stripAnsi(evidence.error.message);
        // Trace beats result.message — merged-blob reports often leave message empty.
        if (!message || message.length < cleaned.length) {
          message = cleaned;
          stackTrace = evidence.error.stack || stackTrace;
        }
      }
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
    consoleEvents,
    networkEvents,
    actionLog,
    environment,
  };
}

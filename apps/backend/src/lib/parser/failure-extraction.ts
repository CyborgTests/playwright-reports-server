/**
 * Shared helpers for extracting Playwright failure context from on-disk reports.
 *
 * Why this exists: the merged-blob `report.json` format frequently leaves
 * `result.message` empty. The actual error text lives in two attachment files:
 *
 *   - `error-context` — markdown DOM snapshot (Playwright's "Copy prompt" source).
 *     Useful for LLM context but doesn't contain the error string itself.
 *   - `trace` — ZIP containing `test.trace` (JSONL). Has the structured error
 *     entry with `message` + `stack` — the canonical source.
 *
 * Both the upload-time heuristic (testManagement.processReport) and the LLM
 * analysis queue need to read these the same way; centralising the logic here
 * keeps them in sync.
 */
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import JSZip from 'jszip';
import { REPORTS_FOLDER } from '../storage/constants.js';

const ERROR_CONTEXT_MAX_CHARS = 4000;
const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_ESCAPE_RE, '');
}

export interface AttachmentLike {
  name?: string;
  path?: string;
}

/**
 * Synchronously read the `error-context` attachment file (truncated to
 * ERROR_CONTEXT_MAX_CHARS). Returns '' when no such attachment exists or the
 * file is missing/unreadable.
 */
export function readErrorContextSync(
  reportId: string,
  attachments?: AttachmentLike[]
): string {
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

/**
 * Asynchronously extract the structured error entry from a Playwright trace ZIP.
 * Returns null when the file is unreadable or contains no error entry.
 */
export async function extractErrorFromTrace(
  reportId: string,
  tracePath: string
): Promise<{ message: string; stack: string } | null> {
  try {
    const reportDir = path.join(REPORTS_FOLDER, reportId);
    const zipBuffer = await fs.readFile(path.join(reportDir, tracePath));
    const zip = await JSZip.loadAsync(zipBuffer);
    const testTraceFile = zip.file('test.trace');
    if (!testTraceFile) return null;

    const content = await testTraceFile.async('string');
    const lines = content.split('\n').filter((l: string) => l.trim());

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as {
          type?: string;
          message?: string;
          stack?: unknown;
          error?: { message?: string; stack?: unknown };
        };

        // "error" entries carry message + structured stack frames.
        if (entry.type === 'error' && entry.message) {
          const stackLines = Array.isArray(entry.stack)
            ? entry.stack
                .map((s: { file?: string; line?: number; column?: number; function?: string }) =>
                  `    at ${s.function ? `${s.function} ` : ''}(${s.file}:${s.line}:${s.column})`
                )
                .join('\n')
            : typeof entry.stack === 'string'
              ? entry.stack
              : '';
          return { message: entry.message, stack: stackLines };
        }

        // "after" entries occasionally carry an error field.
        if (entry.type === 'after' && entry.error?.message) {
          return {
            message: entry.error.message,
            stack: typeof entry.error.stack === 'string' ? entry.error.stack : '',
          };
        }
      } catch {
        // skip unparseable lines
      }
    }

    return null;
  } catch (error) {
    console.error(`[failure-extraction] Failed to read trace ${tracePath}:`, error);
    return null;
  }
}

export interface FailureExtractionResult {
  message: string;
  stackTrace?: string;
}

/**
 * Best-effort extraction of error text for a single failed test attempt.
 * Combines `result.message`, the trace-zip error entry, and the error-context
 * DOM snapshot — in that order of preference for the leading text. Returns the
 * synthetic "Test {outcome}: {title}" string only if no other source yielded
 * anything, so signature grouping still works.
 */
export async function extractFailureMessage(
  reportId: string,
  test: { title?: string; outcome?: string },
  result: {
    status?: string;
    message?: string;
    attachments?: Array<{ name?: string; path?: string; contentType?: string }>;
  }
): Promise<FailureExtractionResult> {
  let message = stripAnsi(result.message || '');
  let stackTrace: string | undefined;

  // Split a stack trace concatenated into the message.
  if (message) {
    const stackIndex = message.indexOf('\n    at ');
    if (stackIndex > 0) {
      stackTrace = message.substring(stackIndex);
      message = message.substring(0, stackIndex);
    }
  }

  // Trace ZIP — richest source. Use it whenever available.
  const traceAtt = result.attachments?.find((a) => a.name === 'trace' && a.path);
  if (traceAtt?.path) {
    const traceError = await extractErrorFromTrace(reportId, traceAtt.path);
    if (traceError?.message) {
      // Trace beats result.message (which may be partial / empty in merged reports).
      const cleaned = stripAnsi(traceError.message);
      if (!message || message.length < cleaned.length) {
        message = cleaned;
        stackTrace = traceError.stack || stackTrace;
      }
    }
  }

  // Append the DOM snapshot as supplementary page context. It's not the error
  // itself but gives the heuristic / LLM something to chew on.
  const ctx = readErrorContextSync(reportId, result.attachments);
  if (ctx) {
    message = message ? `${message}\n\n# Page Context\n\n${ctx}` : ctx;
  }

  // Last-resort fallback so signature grouping still groups same-test failures.
  if (!message) {
    message = `Test ${test.outcome ?? result.status ?? 'failed'}: ${test.title ?? 'Unknown Test'}`;
  }

  return { message, stackTrace };
}

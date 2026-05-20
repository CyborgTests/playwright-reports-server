/**
 * Single entry point for reading a `test_runs.failure_details` JSON column.
 * Strategies need overlapping subsets of the payload — message, stack trace,
 * file path — and each one parsed the JSON on its own, sometimes multiple
 * times per run. This helper parses once and tolerates malformed rows.
 */

const MESSAGE_MAX_CHARS = 2000;

export interface FailureLocation {
  file: string;
  line: number;
  column?: number;
}

export interface FailureAttachment {
  name: string;
  path: string;
  contentType: string;
}

export interface ParsedFailureDetails {
  message: string;
  stackTrace?: string;
  filePath: string;
  location?: FailureLocation;
  attachments?: FailureAttachment[];
}

export function parseFailureDetails(details: string | undefined): ParsedFailureDetails | undefined {
  if (!details) return undefined;
  try {
    const raw = JSON.parse(details) as {
      message?: string;
      stackTrace?: string;
      filePath?: string;
      location?: FailureLocation;
      attachments?: FailureAttachment[];
    };
    return {
      message: String(raw.message ?? '').slice(0, MESSAGE_MAX_CHARS),
      stackTrace: typeof raw.stackTrace === 'string' ? raw.stackTrace : undefined,
      filePath: String(raw.filePath ?? ''),
      location: raw.location,
      attachments: Array.isArray(raw.attachments) ? raw.attachments : undefined,
    };
  } catch {
    // Tolerate unparseable failure_details — older rows or schema drift.
    return undefined;
  }
}

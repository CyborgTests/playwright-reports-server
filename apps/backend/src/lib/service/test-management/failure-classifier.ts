import {
  FAILURE_CATEGORIES,
  type FailureCategory,
  ROOT_CAUSE_CATEGORIES,
  type RootCauseCategory,
} from '@playwright-reports/shared';
import { testAnalyticsDb } from '../db/index.js';

const KNOWN_CATEGORIES = new Set<string>(FAILURE_CATEGORIES);
const KNOWN_ROOT_CAUSE_CATEGORIES = new Set<string>(ROOT_CAUSE_CATEGORIES);

export function isKnownCategory(value: string | undefined | null): value is FailureCategory {
  return !!value && KNOWN_CATEGORIES.has(value);
}

export function isRootCauseCategory(value: string | undefined | null): value is RootCauseCategory {
  return !!value && KNOWN_ROOT_CAUSE_CATEGORIES.has(value);
}

export function detectFailureCategory(errorMessage: string): FailureCategory {
  if (!errorMessage) return 'unknown';
  const msg = errorMessage.trim();
  const lower = msg.toLowerCase();

  const errorNameMatch = msg.match(/^([A-Z][A-Za-z]*Error)\b/);
  const errorName = errorNameMatch?.[1];

  if (
    /Target page, context or browser has been closed/.test(msg) ||
    /Page (?:crashed|closed)/.test(msg) ||
    /browser has (?:disconnected|been closed)/i.test(msg) ||
    /Execution context (?:was destroyed|is unavailable)/.test(msg)
  ) {
    return 'browser_crash';
  }

  if (
    /Screenshot comparison failed/.test(msg) ||
    /toHaveScreenshot|toMatchSnapshot/.test(msg) ||
    /pixels?\s+\(?ratio/.test(msg)
  ) {
    return 'snapshot_mismatch';
  }

  if (
    /net::ERR_[A-Z_]+/.test(msg) ||
    /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b/.test(msg)
  ) {
    return 'network_error';
  }

  if (
    /\b(?:beforeAll|afterAll|beforeEach|afterEach)\b/.test(msg) ||
    /Error in fixture\b/.test(msg) ||
    /Worker process (?:exited|crashed)/.test(msg)
  ) {
    return 'setup_teardown';
  }

  const isExpect = /\bexpect\s*\(/.test(msg);
  if (isExpect) {
    if (
      /\.(?:toBeVisible|toBeAttached|toBeEnabled|toBeFocused|toBeInViewport|toContainText|toHaveText|toHaveValue|toHaveCount|toHaveAttribute|toBeChecked)\b/.test(
        msg
      ) &&
      /Timed? out|Timeout/i.test(msg)
    ) {
      return 'element_not_visible';
    }
    if (
      /\.(?:toEqual|toBe|toMatch|toContain|toStrictEqual|toHaveLength|toBeTruthy|toBeFalsy|toBeNull|toBeDefined|toBeGreaterThan|toBeLessThan|toBeCloseTo)\b/.test(
        msg
      )
    ) {
      return 'assertion_error';
    }
  }

  if (
    /resolved to 0 elements/.test(msg) ||
    /strict mode violation/i.test(msg) ||
    /locator\.\w+: .*not found/i.test(msg) ||
    /No node found for selector/.test(msg)
  ) {
    return 'element_not_found';
  }

  if (
    errorName === 'TimeoutError' ||
    /^Test timeout of \d+ms exceeded/.test(msg) ||
    /\bTimeout \d+ms exceeded\b/.test(msg) ||
    /exceeded the maximum/i.test(lower)
  ) {
    return 'timeout';
  }

  if (
    /page\.(?:goto|reload|goBack|goForward):/.test(msg) ||
    /Navigation (?:failed|timeout|to .+ was interrupted)/i.test(msg) ||
    /frame (?:was )?detached/i.test(msg)
  ) {
    return 'navigation_error';
  }

  const statusCodeMatch = msg.match(/\bstatus(?:\s+code)?[:\s]+(\d{3})\b/i);
  if (statusCodeMatch) {
    const status = Number(statusCodeMatch[1]);
    if (status === 401 || status === 403) return 'authentication_error';
    if (status >= 400) return 'api_error';
  }
  if (/\bHTTP\s+(?:4|5)\d{2}\b/.test(msg)) {
    return 'api_error';
  }

  if (
    /\b(?:Unauthorized|Forbidden)\b/.test(msg) ||
    /\b401\b|\b403\b/.test(msg) ||
    /(?:authentication|login|credentials) (?:failed|required|invalid)/i.test(msg)
  ) {
    return 'authentication_error';
  }

  if (
    /^(?:ReferenceError|SyntaxError|TypeError):/.test(msg) ||
    /Uncaught \(in promise\)/.test(msg) ||
    /page\.evaluate(?:Handle)?:/.test(msg)
  ) {
    return 'javascript_error';
  }

  return 'unknown';
}

const CONSENSUS_MIN_OBSERVATIONS = 3;
const CONSENSUS_MIN_SHARE = 0.7;

export function classifyFailure(
  errorMessage: string,
  errorSignature: string | null
): { category: FailureCategory; source: 'heuristic' | 'consensus' } {
  if (errorSignature) {
    const consensus = testAnalyticsDb.getCategoryConsensus(errorSignature);
    if (
      consensus &&
      isKnownCategory(consensus.category) &&
      consensus.total >= CONSENSUS_MIN_OBSERVATIONS &&
      consensus.share >= CONSENSUS_MIN_SHARE
    ) {
      return { category: consensus.category, source: 'consensus' };
    }
  }
  return { category: detectFailureCategory(errorMessage), source: 'heuristic' };
}

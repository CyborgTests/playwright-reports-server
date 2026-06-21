/**
 * Route a failure by error class, deciding how it's keyed:
 *   global — infra (server 5xx / network / browser); keyed by error message,
 *            location ignored, so it collapses across files.
 *   local  — assertions/selectors/timeouts; keyed by frame ∪ locator.
 */

export type RouteScope = 'global' | 'local';

export type ErrorClass =
  | 'server-error'
  | 'network'
  | 'browser-infra'
  | 'timeout'
  | 'assertion'
  | 'selector'
  | 'other';

export interface Route {
  scope: RouteScope;
  errorClass: ErrorClass;
}

interface Rule {
  errorClass: ErrorClass;
  scope: RouteScope;
  pattern: RegExp;
}

const RULES: Rule[] = [
  {
    errorClass: 'server-error',
    scope: 'global',
    pattern: /internal server error|\bhttp\s*5\d\d\b|\b5\d\d\b[^\n]*\b(?:error|status)\b/i,
  },
  {
    errorClass: 'network',
    scope: 'global',
    pattern: /\b(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|EAI_AGAIN)\b|fetch failed|net::ERR/i,
  },
  {
    errorClass: 'browser-infra',
    scope: 'global',
    pattern:
      /target (?:page|frame|context)?\s*closed|browser has been closed|crashed|Protocol error|websocket (?:error|closed)/i,
  },
  // local classes — kept for display/category; all key the same way (frame ∪ locator).
  { errorClass: 'timeout', scope: 'local', pattern: /test timeout of \d+ms exceeded/i },
  {
    errorClass: 'assertion',
    scope: 'local',
    pattern: /\bexpect\(|\bto(?:Be|Have|Contain|Equal|Match)[A-Za-z]*\(/,
  },
  { errorClass: 'selector', scope: 'local', pattern: /\b(?:locator|getBy[A-Za-z]+)\s*\(/ },
];

export function route(message: string | undefined): Route {
  const text = message ?? '';
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return { scope: rule.scope, errorClass: rule.errorClass };
    }
  }
  return { scope: 'local', errorClass: 'other' };
}

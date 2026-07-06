import { PLAYWRIGHT_VERBS, type PlaywrightVerb } from '@playwright-reports/shared';

const EXPECT_LOCATOR_VERB_RE = /^(?:Error:\s*)?expect\([^)]+\)\.([A-Za-z]+)\(/m;
const EXPECT_DOT_VERB_RE = /^(?:Error:\s*)?expect\.([A-Za-z]+):/m;
const LOCATOR_ACTION_VERB_RE = /^(?:Error:\s*)?(?:locator|page|frame)\.([A-Za-z]+):/m;
const STRICT_MODE_RE = /strict mode violation/i;
const TEST_TIMEOUT_BARE_RE = /^(?:Error:\s*)?Test timeout of \d+ms exceeded\.?\s*$/m;

const KNOWN_VERBS = new Set<string>(PLAYWRIGHT_VERBS);

export function extractVerb(message: string | undefined): PlaywrightVerb {
  if (!message) return 'unknown';

  // Strict-mode violation wins over verb detection - the assertion verb
  // (toBeVisible / toBe / …) is incidental; the real mechanism is that the
  // selector is ambiguous, and that's a single fix anchor regardless of the
  // verb that exposed it.
  if (STRICT_MODE_RE.test(message)) return 'strictModeViolation';

  const locVerb = EXPECT_LOCATOR_VERB_RE.exec(message)?.[1];
  if (locVerb && KNOWN_VERBS.has(locVerb)) return locVerb as PlaywrightVerb;

  const dotVerb = EXPECT_DOT_VERB_RE.exec(message)?.[1];
  if (dotVerb && KNOWN_VERBS.has(dotVerb)) return dotVerb as PlaywrightVerb;

  const actVerb = LOCATOR_ACTION_VERB_RE.exec(message)?.[1];
  if (actVerb && KNOWN_VERBS.has(actVerb)) return actVerb as PlaywrightVerb;

  if (TEST_TIMEOUT_BARE_RE.test(message)) return 'testTimeout';

  return 'unknown';
}

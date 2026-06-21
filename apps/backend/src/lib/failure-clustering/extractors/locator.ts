const LOCATOR_LINE_RE = /^\s*Locator:\s*(.+?)\s*$/m;
const CALL_LOG_WAITING_RE = /^\s*[-•]?\s*waiting for\s+(.+?)\s*$/m;
const INLINE_LOCATOR_RE =
  /\b(locator|getByRole|getByLabel|getByText|getByTestId|getByPlaceholder|getByTitle|getByAltText)\s*\(/;

const UUID_LIKE_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_HEX_RE = /\b[0-9a-f]{16,}\b/gi;
const POSITIONAL_REFINEMENT_RE = /\.(?:first\(\)|last\(\)|nth\([^()]*\)|describe\([^()]*\))\s*$/g;

export function extractLocator(message: string | undefined): string | undefined {
  if (!message) return undefined;

  const explicit = LOCATOR_LINE_RE.exec(message);
  if (explicit) return explicit[1].trim();

  const waiting = CALL_LOG_WAITING_RE.exec(message);
  if (waiting && INLINE_LOCATOR_RE.test(waiting[1])) return waiting[1].trim();

  for (const line of message.split('\n')) {
    const idx = line.search(INLINE_LOCATOR_RE);
    if (idx === -1) continue;
    return line.slice(idx).trim();
  }
  return undefined;
}

/**
 * Normalize a locator string so functionally identical locators across runs
 * collapse to the same key. Strips trailing positional refinements
 * (`.first()`, `.last()`, `.nth(N)`, `.describe(...)`) and wipes UUID-shaped
 * row ids that vary per run. `.filter(...)`, `.and(...)`, `.or(...)` are
 * preserved because their arguments determine which element is targeted.
 */
const DIGIT_RUN_RE = /\d+/g;

export function normalizeLocator(locator: string): string {
  let normalized = locator
    .replace(UUID_LIKE_RE, '<id>')
    .replace(LONG_HEX_RE, '<id>')
    .replace(DIGIT_RUN_RE, '<n>');
  for (let i = 0; i < 4; i++) {
    const next = normalized.replace(POSITIONAL_REFINEMENT_RE, '');
    if (next === normalized) break;
    normalized = next;
  }
  return normalized.trim();
}

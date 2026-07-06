/**
 * Clustering keys for a failure (a SET; union-find merges failures sharing any
 * key).
 *   local  -> "frame:<file:line>" and/or "loc:<normalizedLocator>"
 *            ("fixture:<phase>:<file>" for hooks, "msg:<sig>" as fallback)
 *   global -> "global:<errorClass>:<sig>"  (location ignored)
 * Verb is not part of any key - same frame -> same cluster regardless of verb.
 */
import type { ParsedFailureDetails } from './extractors/failure-details.js';
import { detectFixturePhase } from './extractors/fixture-context.js';
import { extractLocator, normalizeLocator } from './extractors/locator.js';
import { extractFrameFromFailure } from './extractors/stack-trace.js';
import type { Route } from './route.js';

export const FIXTURE_PREFIX = 'fixture:';
export const FRAME_PREFIX = 'frame:';
export const LOCATOR_PREFIX = 'loc:';
export const GLOBAL_PREFIX = 'global:';
export const MESSAGE_PREFIX = 'msg:';

const MESSAGE_SIGNATURE_MAX = 80;

export function messageSignature(message: string | undefined): string {
  const firstLine =
    (message ?? '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? '';
  return firstLine
    .replace(/0x[0-9a-fA-F]+/g, 'H')
    .replace(/['"][^'"]*['"]/g, 'S')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MESSAGE_SIGNATURE_MAX);
}

export function frameKeyOf(parsed: ParsedFailureDetails): string | undefined {
  return extractFrameFromFailure(parsed);
}

export function locatorKeyOf(parsed: ParsedFailureDetails): string | undefined {
  const raw = extractLocator(parsed.message);
  if (!raw) return undefined;
  const normalized = normalizeLocator(raw);
  return normalized || undefined;
}

export function keysFor(parsed: ParsedFailureDetails, routed: Route): string[] {
  if (routed.scope === 'global') {
    return [`${GLOBAL_PREFIX}${routed.errorClass}:${messageSignature(parsed.message)}`];
  }
  const phase = detectFixturePhase(parsed.message);
  if (phase && parsed.filePath) {
    return [`${FIXTURE_PREFIX}${phase}:${parsed.filePath}`];
  }
  const keys: string[] = [];
  const frame = frameKeyOf(parsed);
  if (frame) keys.push(`${FRAME_PREFIX}${frame}`);
  const locator = locatorKeyOf(parsed);
  if (locator) keys.push(`${LOCATOR_PREFIX}${locator}`);
  if (keys.length === 0) {
    keys.push(`${MESSAGE_PREFIX}${messageSignature(parsed.message)}`);
  }
  return keys;
}

// Priority for choosing a component's identity key.
// The locator is main unifier - if a set is held together,
// that locator IS its identity and is stable across frame.
// A pure-frame set is identified by its frame.
const KEY_PRIORITY: ReadonlyArray<string> = [
  FIXTURE_PREFIX,
  LOCATOR_PREFIX,
  FRAME_PREFIX,
  GLOBAL_PREFIX,
  MESSAGE_PREFIX,
];

function priorityOf(key: string): number {
  const idx = KEY_PRIORITY.findIndex((p) => key.startsWith(p));
  return idx === -1 ? KEY_PRIORITY.length : idx;
}

/**
 * Deterministic identity key for a cluster: highest-priority key, then
 * lexicographically smallest within that priority. Same set of keys -> same
 * canonical key, independent of order. The cluster ID is sha1 of it.
 */
export function canonicalKey(keys: string[]): string {
  if (keys.length === 0) throw new Error('canonicalKey: empty key set');
  let best = keys[0];
  let bestPriority = priorityOf(best);
  for (const key of keys) {
    const p = priorityOf(key);
    if (p < bestPriority || (p === bestPriority && key < best)) {
      best = key;
      bestPriority = p;
    }
  }
  return best;
}

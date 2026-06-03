import type { ClusterAnchor, PlaywrightVerb } from '@playwright-reports/shared';
import type { ParsedFailureDetails } from './extractors/failure-details.js';
import { detectFixturePhase } from './extractors/fixture-context.js';
import { extractLocator, normalizeLocator } from './extractors/locator.js';
import { extractFrameFromFailure } from './extractors/stack-trace.js';
import { extractVerb } from './extractors/verb.js';
import type { FailedTestRun } from './types.js';

/**
 * Map a parsed failure to its cluster anchor. The anchor IS the cluster
 * identity — same anchor key → same cluster, with no merging, no precedence
 * fallback, no temporal grouping.
 *
 * Priority order:
 *   1. fixture  — failure occurred in a hook; the hook is the root cause and
 *                 dominates whichever selector/frame surfaced the symptom.
 *   2. selector — a Playwright locator is identifiable in the message; UI
 *                 element identity is the most cross-cutting fix anchor
 *                 (one aria-label rename can break N tests across files).
 *   3. frame    — app-code file:line of the failing statement; concrete fix
 *                 location when no selector is involved.
 *   4. unmatched — no usable signal; anchor = test identity so chronic
 *                 failures of the same test still cluster together.
 *
 * The Playwright verb is part of every anchor (except `unmatched`). Two
 * tests failing at the same line but with different verbs (e.g. one click,
 * one toBeVisible) are usually different fixes and stay in separate
 * clusters.
 */
export function classify(run: FailedTestRun, parsed: ParsedFailureDetails): ClusterAnchor {
  const verb: PlaywrightVerb = extractVerb(parsed.message);

  // 1. Fixture phase — most specific scope.
  const phase = detectFixturePhase(parsed.message);
  if (phase && parsed.filePath) {
    return { kind: 'fixture', verb, phase, filePath: parsed.filePath };
  }

  // 2. Selector — when an extractable locator exists, it's the cross-cutting
  //    fix anchor. Normalization wipes per-run UUID-shaped tokens so e.g.
  //    `locator('div[row-id*="<uuid1>"]')` and `…"<uuid2>"…` collapse.
  const rawSelector = extractLocator(parsed.message);
  if (rawSelector) {
    const selector = normalizeLocator(rawSelector);
    if (selector) return { kind: 'selector', verb, selector };
  }

  // 3. Frame — file:line of the failing statement. Read both `stackTrace`
  //    and the codeframe embedded inside `message`.
  const frame = extractFrameFromFailure(parsed);
  if (frame) return { kind: 'frame', verb, frame };

  // 4. Fallback — test identity. Repeated failures of the same test cluster
  //    together even without a mechanism we can name.
  return {
    kind: 'unmatched',
    testId: run.testId,
    fileId: run.fileId,
    project: run.project,
  };
}

/**
 * Stable string identity for an anchor. Two anchors yield the same key iff
 * they are field-by-field equal.
 *
 * Encoded as a JSON array so any string content — file paths with spaces,
 * locators with colons or quotes — is canonically escaped. Two different
 * anchors can never accidentally encode to the same key, and the encoding
 * is round-trip-debuggable (the key is human-readable JSON).
 *
 * The cluster ID is `sha1(anchorKey(anchor)).slice(0, 16)`, so it is
 * deterministic across calls / processes / machines.
 */
export function anchorKey(anchor: ClusterAnchor): string {
  switch (anchor.kind) {
    case 'fixture':
      return JSON.stringify(['fixture', anchor.verb, anchor.phase, anchor.filePath]);
    case 'selector':
      return JSON.stringify(['selector', anchor.verb, anchor.selector]);
    case 'frame':
      return JSON.stringify(['frame', anchor.verb, anchor.frame]);
    case 'unmatched':
      return JSON.stringify(['unmatched', anchor.project, anchor.fileId, anchor.testId]);
  }
}

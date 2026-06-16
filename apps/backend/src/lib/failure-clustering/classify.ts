import type { ClusterAnchor, PlaywrightVerb } from '@playwright-reports/shared';
import type { ParsedFailureDetails } from './extractors/failure-details.js';
import { detectFixturePhase } from './extractors/fixture-context.js';
import { extractLocator, normalizeLocator } from './extractors/locator.js';
import { extractFrameFromFailure } from './extractors/stack-trace.js';
import { extractVerb } from './extractors/verb.js';
import type { FailedTestRun } from './types.js';

/**
 * Map a parsed failure to its cluster anchor — same anchor key → same cluster,
 * no merging or temporal grouping. Anchors are tried most- to least-specific:
 *   1. fixture   — hook failure; the hook is root cause over any selector/frame symptom.
 *   2. selector  — a locator in the message; most cross-cutting fix (one rename breaks N tests).
 *   3. frame     — app-code file:line of the failing statement.
 *   4. signature — upstream errorSignatureGlobal; groups shared error shapes (timeouts, crashes).
 *   5. unmatched — no signal; anchor = test identity so chronic failures still cluster.
 *
 * The verb is part of every anchor but `unmatched`: same line + different verb
 * (click vs toBeVisible) is usually a different fix, so they stay separate.
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

  // 4. Signature — upstream-computed error_signature_global. Used as a
  //    secondary key for the cases where extractors find nothing but
  //    multiple tests share an identical failure shape.
  if (run.errorSignatureGlobal && run.errorSignatureGlobal.length > 0) {
    return { kind: 'signature', verb, signature: run.errorSignatureGlobal };
  }

  // 5. Fallback — test identity. Repeated failures of the same test cluster
  //    together even without a mechanism we can name.
  return {
    kind: 'unmatched',
    testId: run.testId,
    fileId: run.fileId,
    project: run.project,
  };
}

/**
 * Stable string identity for an anchor — equal iff field-by-field equal. The
 * cluster ID is `sha1(anchorKey(anchor)).slice(0, 16)`, deterministic across
 * calls, processes, and machines.
 */
export function anchorKey(anchor: ClusterAnchor): string {
  switch (anchor.kind) {
    case 'fixture':
      return JSON.stringify(['fixture', anchor.verb, anchor.phase, anchor.filePath]);
    case 'selector':
      return JSON.stringify(['selector', anchor.verb, anchor.selector]);
    case 'frame':
      return JSON.stringify(['frame', anchor.verb, anchor.frame]);
    case 'signature':
      return JSON.stringify(['signature', anchor.verb, anchor.signature]);
    case 'unmatched':
      return JSON.stringify(['unmatched', anchor.project, anchor.fileId, anchor.testId]);
  }
}

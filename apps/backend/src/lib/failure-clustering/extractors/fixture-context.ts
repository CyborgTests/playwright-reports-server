import type { FixturePhase } from '../types.js';

/**
 * Identify the Playwright fixture phase that produced a failure.
 *
 * Playwright's merged-blob report.json does not expose a structured phase
 * field on `test.results[]`, so we derive it heuristically from the error
 * message. The same heuristic feeds the `setup_teardown` failure category
 * upstream (see `detectFailureCategory`). When no hook marker appears in
 * the message, we return undefined - fixture-strategy clustering then
 * skips that run.
 */

const PHASE_PATTERNS: Array<{ phase: FixturePhase; pattern: RegExp }> = [
  { phase: 'beforeAll', pattern: /\bbeforeAll\b/ },
  { phase: 'afterAll', pattern: /\bafterAll\b/ },
  { phase: 'beforeEach', pattern: /\bbeforeEach\b/ },
  { phase: 'afterEach', pattern: /\bafterEach\b/ },
];

export function detectFixturePhase(message: string | undefined): FixturePhase | undefined {
  if (!message) return undefined;
  for (const { phase, pattern } of PHASE_PATTERNS) {
    if (pattern.test(message)) return phase;
  }
  return undefined;
}

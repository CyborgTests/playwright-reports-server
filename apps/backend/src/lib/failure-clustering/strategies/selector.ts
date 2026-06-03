import { v4 as uuid } from 'uuid';
import { parseFailureDetails } from '../extractors/failure-details.js';
import { extractLocator, normalizeLocator } from '../extractors/locator.js';
import { type ClusterWithRuns, FAILED_OUTCOMES, type FailedTestRun, testKey } from '../types.js';

export interface SelectorStrategyOptions {
  minTests: number;
}

interface SelectorInfo {
  selector: string;
  displaySelector: string;
  message: string;
  runs: FailedTestRun[];
}

/**
 * Group failed runs by the Playwright locator that didn't satisfy the
 * assertion / action. UI-selector drift (an aria-label rename, a column-id
 * change) typically breaks N tests across multiple files at once — fixing the
 * selector once resolves the entire cluster. Strategies based on stack frame
 * miss this because the frames are spread across many page objects; signature
 * strategies miss it because the surface error templates differ
 * (`toBeVisible` vs `click: Timeout` vs `toHaveText`).
 *
 * Membership rule: at least `minTests` distinct tests must share the same
 * normalized selector. Normalization strips per-run UUID-shaped row ids and
 * trailing `.first()`/`.nth(N)`/`.filter({...})` refinements so the same
 * underlying selector clusters even when call sites differ.
 */
export function clusterBySelector(
  runs: FailedTestRun[],
  opts: SelectorStrategyOptions
): ClusterWithRuns[] {
  const bySelector = new Map<string, SelectorInfo>();

  for (const run of runs) {
    if (!FAILED_OUTCOMES.has(run.outcome)) continue;
    const parsed = parseFailureDetails(run.failureDetails);
    if (!parsed) continue;
    const raw = extractLocator(parsed.message);
    if (!raw) continue;
    const selector = normalizeLocator(raw);
    if (!selector) continue;

    const existing = bySelector.get(selector);
    if (existing) {
      existing.runs.push(run);
    } else {
      bySelector.set(selector, {
        selector,
        displaySelector: raw,
        message: parsed.message,
        runs: [run],
      });
    }
  }

  const result: ClusterWithRuns[] = [];
  for (const info of bySelector.values()) {
    const uniqueTests = new Set(info.runs.map((r) => testKey(r.testId, r.fileId, r.project)));
    if (uniqueTests.size < opts.minTests) continue;

    const categoryCounts = new Map<string, number>();
    for (const r of info.runs) {
      if (r.failureCategory) {
        categoryCounts.set(r.failureCategory, (categoryCounts.get(r.failureCategory) ?? 0) + 1);
      }
    }
    const category = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    result.push({
      cluster: {
        id: uuid(),
        strategy: 'selector',
        name: `Selector ${truncate(info.displaySelector, 80)}`,
        sampleMessage: info.message,
        category,
        testCount: uniqueTests.size,
        failureCount: info.runs.length,
        evidence: { selector: info.selector },
        tests: [],
      },
      runs: info.runs,
    });
  }

  return result.sort((a, b) => b.cluster.failureCount - a.cluster.failureCount);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

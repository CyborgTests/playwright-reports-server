import {
  histogramAdd,
  histogramDecode,
  histogramEncode,
  histogramMerge,
  histogramSubtract,
  newHistogram,
} from './histogram.js';

export interface RunDeltaInput {
  project: string;
  outcome: string;
  duration: number | null | undefined;
  createdAt: string;
  testId: string;
  fileId: string;
}

export interface DayDelta {
  runs: number;
  executed: number;
  passed: number;
  failed: number;
  flaky: number;
  sumDuration: number;
  durationCount: number;
  buckets: Uint32Array;
}

export interface SerializedDelta {
  runs: number;
  executed: number;
  passed: number;
  failed: number;
  flaky: number;
  sumDuration: number;
  durationCount: number;
  buckets: string; // base64-encoded duration distribution (~256 B)
}

const PASSED_OUTCOMES = new Set(['expected', 'passed']);
const SKIPPED_OUTCOMES = new Set(['skipped']);
const FLAKY_OUTCOMES = new Set(['flaky']);

export function utcDayKey(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

export function newDayDelta(): DayDelta {
  return {
    runs: 0,
    executed: 0,
    passed: 0,
    failed: 0,
    flaky: 0,
    sumDuration: 0,
    durationCount: 0,
    buckets: newHistogram(),
  };
}

export function collectRunDeltas(runs: RunDeltaInput[]): Map<string, DayDelta> {
  const byDay = new Map<string, DayDelta>();
  for (const run of runs) {
    const day = utcDayKey(run.createdAt);
    let delta = byDay.get(day);
    if (!delta) {
      delta = newDayDelta();
      byDay.set(day, delta);
    }
    delta.runs += 1;
    const skipped = SKIPPED_OUTCOMES.has(run.outcome);
    if (skipped) continue;
    delta.executed += 1;
    if (PASSED_OUTCOMES.has(run.outcome)) {
      delta.passed += 1;
    } else if (FLAKY_OUTCOMES.has(run.outcome)) {
      delta.flaky += 1;
    } else {
      delta.failed += 1;
    }
    if (run.duration !== null && run.duration !== undefined && run.duration >= 0) {
      delta.sumDuration += run.duration;
      delta.durationCount += 1;
      histogramAdd(delta.buckets, run.duration);
    }
  }
  return byDay;
}

function _addDelta(target: DayDelta, source: SerializedDelta, negate = false): void {
  const sign = negate ? -1 : 1;
  target.runs += sign * source.runs;
  target.executed += sign * source.executed;
  target.passed += sign * source.passed;
  target.failed += sign * source.failed;
  target.flaky += sign * source.flaky;
  target.sumDuration += sign * source.sumDuration;
  target.durationCount += sign * source.durationCount;
  if (negate) {
    target.buckets = histogramSubtract(
      target.buckets,
      histogramDecode(Buffer.from(source.buckets, 'base64'))
    );
    return;
  }
  histogramMerge(
    target.buckets,
    histogramDecode(Buffer.from(source.buckets, 'base64')),
    target.buckets
  );
}

export function serializeDelta(delta: DayDelta): string {
  const payload: SerializedDelta = {
    runs: delta.runs,
    executed: delta.executed,
    passed: delta.passed,
    failed: delta.failed,
    flaky: delta.flaky,
    sumDuration: delta.sumDuration,
    durationCount: delta.durationCount,
    buckets: histogramEncode(delta.buckets).toString('base64'),
  };
  return JSON.stringify(payload);
}

export function deserializeDelta(json: string): SerializedDelta {
  return JSON.parse(json) as SerializedDelta;
}

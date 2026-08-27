export interface LaneGate {
  lanes: number[];
  slots: number;
}

function pickLeastLoaded(lanes: number[], slots: number): number[] {
  const want = Math.min(Math.max(1, slots), lanes.length);
  return lanes
    .map((_, index) => index)
    .sort((a, b) => lanes[a] - lanes[b])
    .slice(0, want);
}

export function packGates(gates: LaneGate[], durationMs: number, earliestStartMs: number): number {
  const chosen = gates.map((gate) => pickLeastLoaded(gate.lanes, gate.slots));
  let start = earliestStartMs;
  gates.forEach((gate, index) => {
    for (const slot of chosen[index]) start = Math.max(start, gate.lanes[slot]);
  });
  const finish = start + durationMs;
  gates.forEach((gate, index) => {
    for (const slot of chosen[index]) gate.lanes[slot] = finish;
  });
  return finish;
}

export function packLanes(
  lanes: number[],
  slots: number,
  durationMs: number,
  earliestStartMs: number
): number {
  return packGates([{ lanes, slots }], durationMs, earliestStartMs);
}

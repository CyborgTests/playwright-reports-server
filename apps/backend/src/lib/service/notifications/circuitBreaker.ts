const FAILURE_THRESHOLD = 5;
const OPEN_DURATION_MS = 5 * 60 * 1000;

interface BreakerState {
  consecutiveFailures: number;
  openUntil: number;
}

const breakers = new Map<string, BreakerState>();

function get(channelId: string): BreakerState {
  let state = breakers.get(channelId);
  if (!state) {
    state = { consecutiveFailures: 0, openUntil: 0 };
    breakers.set(channelId, state);
  }
  return state;
}

export function isOpen(channelId: string): boolean {
  const state = breakers.get(channelId);
  if (!state) return false;
  return Date.now() < state.openUntil;
}

export function recordSuccess(channelId: string): void {
  const state = breakers.get(channelId);
  if (!state) return;
  state.consecutiveFailures = 0;
  state.openUntil = 0;
}

export function recordFailure(channelId: string): void {
  const state = get(channelId);
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
    state.openUntil = Date.now() + OPEN_DURATION_MS;
  }
}

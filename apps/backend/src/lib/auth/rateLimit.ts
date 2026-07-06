// Fixed-window, per-key rate limiter for auth endpoints. Keyed on IP (never on
// username) so an attacker can't lock a known account out - see AUTH_PRD.md.
// In-memory: single-instance app, counters reset on restart (acceptable).

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 20;

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export function allowAttempt(key: string, now = Date.now()): boolean {
  const existing = windows.get(key);
  if (!existing || now > existing.resetAt) {
    if (windows.size > MAX_TRACKED_KEYS) sweepExpired(now);
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (existing.count >= MAX_ATTEMPTS) return false;
  existing.count += 1;
  return true;
}

// Bound memory: drop windows whose interval has elapsed. Only triggered when the
// map grows past a threshold, so the common path stays O(1).
const MAX_TRACKED_KEYS = 10_000;
function sweepExpired(now: number): void {
  for (const [key, window] of windows) {
    if (now > window.resetAt) windows.delete(key);
  }
}

// Reset a key after a successful auth so a busy shared IP isn't penalised.
export function clearAttempts(key: string): void {
  windows.delete(key);
}

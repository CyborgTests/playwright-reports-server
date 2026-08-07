import { AsyncLocalStorage } from 'node:async_hooks';

interface ModelState {
  active: number;
  limit: number;
  waiters: Array<() => void>;
}

export interface Gate {
  key: string;
  limit: number;
}

export interface GateReservation {
  gateKeys: string[];
  release: () => void;
  consumed: boolean;
}

export const reservationStore = new AsyncLocalStorage<GateReservation>();

export function sameGateKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}

export function combineReleases(releases: Array<() => void>): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const release of [...releases].reverse()) release();
  };
}

class ModelGate {
  private readonly state = new Map<string, ModelState>();

  private stateFor(key: string, limit: number): ModelState {
    const max = Math.max(1, Math.floor(limit) || 1);
    let s = this.state.get(key);
    if (!s) {
      s = { active: 0, limit: max, waiters: [] };
      this.state.set(key, s);
    } else {
      s.limit = max; // pick up live config changes
    }
    return s;
  }

  acquire(key: string, limit: number): Promise<() => void> {
    const s = this.stateFor(key, limit);
    const release = this.makeRelease(key);
    if (s.active < s.limit) {
      s.active++;
      return Promise.resolve(release);
    }
    // Saturated: queue. The slot is handed over on release without a decrement,
    // so `active` stays an accurate count of in-flight calls.
    return new Promise<() => void>((resolve) => {
      s.waiters.push(() => resolve(release));
    });
  }

  tryAcquire(key: string, limit: number): (() => void) | null {
    const s = this.stateFor(key, limit);
    if (s.active < s.limit) {
      s.active++;
      return this.makeRelease(key);
    }
    return null;
  }

  tryAcquireAll(gates: readonly Gate[]): (() => void) | null {
    const held: Array<() => void> = [];
    for (const gate of gates) {
      const release = this.tryAcquire(gate.key, gate.limit);
      if (!release) {
        for (const undo of held) undo();
        return null;
      }
      held.push(release);
    }
    return combineReleases(held);
  }

  async run<T>(
    key: string,
    limit: number,
    fn: () => Promise<T>,
    onAcquire?: () => void
  ): Promise<T> {
    return this.runAll([{ key, limit }], fn, onAcquire);
  }

  async runAll<T>(
    gates: readonly Gate[],
    fn: () => Promise<T>,
    onAcquire?: () => void
  ): Promise<T> {
    const held: Array<() => void> = [];
    try {
      for (const gate of gates) held.push(await this.acquire(gate.key, gate.limit));
      onAcquire?.();
      return await fn();
    } finally {
      for (const release of held.reverse()) release();
    }
  }

  private makeRelease(key: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const s = this.state.get(key);
      if (!s) return;
      const next = s.waiters.shift();
      if (next) {
        next(); // hand the slot to the next waiter; `active` unchanged
      } else {
        s.active = Math.max(0, s.active - 1);
      }
    };
  }
}

export const modelGate = new ModelGate();

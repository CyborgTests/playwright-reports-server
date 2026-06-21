import { AsyncLocalStorage } from 'node:async_hooks';

interface ModelState {
  active: number;
  limit: number;
  waiters: Array<() => void>;
}

export interface GateReservation {
  modelId: string;
  consumed: boolean;
}

export const reservationStore = new AsyncLocalStorage<GateReservation>();

class ModelGate {
  private readonly state = new Map<string, ModelState>();

  acquire(modelId: string, limit: number): Promise<() => void> {
    const max = Math.max(1, Math.floor(limit) || 1);
    let s = this.state.get(modelId);
    if (!s) {
      s = { active: 0, limit: max, waiters: [] };
      this.state.set(modelId, s);
    } else {
      s.limit = max; // pick up live config changes
    }

    const release = this.makeRelease(modelId);
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

  tryAcquire(modelId: string, limit: number): (() => void) | null {
    const max = Math.max(1, Math.floor(limit) || 1);
    let s = this.state.get(modelId);
    if (!s) {
      s = { active: 0, limit: max, waiters: [] };
      this.state.set(modelId, s);
    } else {
      s.limit = max;
    }
    if (s.active < s.limit) {
      s.active++;
      return this.makeRelease(modelId);
    }
    return null;
  }

  async run<T>(
    modelId: string,
    limit: number,
    fn: () => Promise<T>,
    onAcquire?: () => void
  ): Promise<T> {
    const release = await this.acquire(modelId, limit);
    try {
      onAcquire?.();
      return await fn();
    } finally {
      release();
    }
  }

  inspect(modelId: string): { active: number; waiting: number; limit: number } {
    const s = this.state.get(modelId);
    return s
      ? { active: s.active, waiting: s.waiters.length, limit: s.limit }
      : { active: 0, waiting: 0, limit: 0 };
  }

  private makeRelease(modelId: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const s = this.state.get(modelId);
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

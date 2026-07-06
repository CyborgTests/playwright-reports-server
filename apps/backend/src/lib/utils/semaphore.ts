/** Caps in-flight async work at `max`; waiters resume FIFO as slots free. */
export class Semaphore {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    while (this.running >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }

    this.running++;

    try {
      return await fn();
    } finally {
      this.running--;
      this.queue.shift()?.();
    }
  }
}

/** Maps `fn` over `items`, ≤`concurrency` in flight. Preserves input order; rejects on first failure. */
export async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const semaphore = new Semaphore(concurrency);
  return Promise.all(items.map((item) => semaphore.run(() => fn(item))));
}

export function singletonOf<T>(key: string, factory: () => T): T {
  const symbol = Symbol.for(`playwright.reports.db.${key}`);
  const store = globalThis as typeof globalThis & Record<symbol, T | undefined>;
  if (!store[symbol]) {
    store[symbol] = factory();
  }
  return store[symbol] as T;
}

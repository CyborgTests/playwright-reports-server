export function singletonOf<T extends object>(key: string, factory: () => T): T {
  const symbol = Symbol.for(`playwright.reports.db.${key}`);
  const store = globalThis as typeof globalThis & Record<symbol, T | undefined>;
  const boundMethods = new Map<PropertyKey, unknown>();

  const resolve = (): T => {
    if (!store[symbol]) {
      store[symbol] = factory();
    }
    return store[symbol] as T;
  };

  return new Proxy(Object.create(null) as T, {
    get(_target, prop) {
      const instance = resolve();
      const value = Reflect.get(instance as object, prop, instance);
      if (typeof value !== 'function') {
        return value;
      }
      // bind once and cache so `this` resolves to the real instance (not the
      // proxy) and repeated calls don't allocate a new bound function each time.
      let bound = boundMethods.get(prop);
      if (!bound) {
        bound = (value as (...args: unknown[]) => unknown).bind(instance);
        boundMethods.set(prop, bound);
      }
      return bound;
    },
    set(_target, prop, value) {
      const instance = resolve();
      return Reflect.set(instance as object, prop, value, instance);
    },
    has(_target, prop) {
      return Reflect.has(resolve() as object, prop);
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(resolve() as object);
    },
  });
}

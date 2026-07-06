// semaphore for /models and test model calls
const MAX_CONCURRENT_PROBES_PER_HOST = 1;

const active = new Map<string, number>();

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
}

export async function withProbeSlot<T>(baseUrl: string, fn: () => Promise<T>): Promise<T> {
  const host = hostOf(baseUrl);
  const count = active.get(host) ?? 0;
  if (count >= MAX_CONCURRENT_PROBES_PER_HOST) {
    throw new Error(
      `Too many concurrent requests to ${host}. Wait for the in-progress test/discovery to finish, then retry.`
    );
  }
  active.set(host, count + 1);
  try {
    return await fn();
  } finally {
    const remaining = (active.get(host) ?? 1) - 1;
    if (remaining <= 0) active.delete(host);
    else active.set(host, remaining);
  }
}

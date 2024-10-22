export async function processBatch<T, R>(
  ctx: unknown,
  items: T[],
  batchSize: number,
  asyncAction: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    const batchResults = await Promise.all(batch.map(asyncAction.bind(ctx)));

    results.push(...batchResults);
  }

  return results;
}

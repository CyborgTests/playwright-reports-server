/**
 * Fixed-size duration distribution used by `daily_test_totals.durationBuckets`.
 *
 * 64 buckets over ~1ms..~19.4h (one bucket per power of two in milliseconds;
 * durations outside the range fall into the first/last bucket). Percentiles
 * (like p95) are estimated within the containing bucket (±half bucket width).
 */
export const HISTOGRAM_BUCKETS = 64;
const BYTES_PER_BUCKET = 4;
export const HISTOGRAM_BYTES = HISTOGRAM_BUCKETS * BYTES_PER_BUCKET;

export const MIN_DURATION_MS = 1;

export function histogramBucketIndex(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs < MIN_DURATION_MS) return 0;
  const idx = Math.floor(Math.log2(durationMs));
  return idx < 0 ? 0 : idx >= HISTOGRAM_BUCKETS ? HISTOGRAM_BUCKETS - 1 : idx;
}

export function newHistogram(): Uint32Array {
  return new Uint32Array(HISTOGRAM_BUCKETS);
}

export function histogramAdd(histogram: Uint32Array, durationMs: number): void {
  histogram[histogramBucketIndex(durationMs)] += 1;
}

export function histogramMerge(a: Uint32Array, b: Uint32Array, into?: Uint32Array): Uint32Array {
  const out = into ?? newHistogram();
  for (let i = 0; i < HISTOGRAM_BUCKETS; i++) out[i] = a[i] + b[i];
  return out;
}

export function histogramSubtract(a: Uint32Array, b: Uint32Array): Uint32Array {
  const out = newHistogram();
  for (let i = 0; i < HISTOGRAM_BUCKETS; i++) out[i] = Math.max(0, a[i] - b[i]);
  return out;
}

export function histogramTotal(histogram: Uint32Array): number {
  let total = 0;
  for (let i = 0; i < HISTOGRAM_BUCKETS; i++) total += histogram[i];
  return total;
}

/**
 * Approximate percentile via bucket walk + linear interpolation inside the
 * containing bucket. Bucket boundaries are [2^i, 2^(i+1)).
 */
export function histogramPercentile(histogram: Uint32Array, p: number): number {
  const total = histogramTotal(histogram);
  if (total === 0) return 0;
  // p is a fraction in [0, 1]; force it into that range, then find the run
  // count position we are looking for.
  const ratio = Math.min(Math.max(p, 0), 1);
  const target = ratio * total;

  let cumulative = 0;
  for (let i = 0; i < HISTOGRAM_BUCKETS; i++) {
    const count = histogram[i];
    if (count === 0) continue;
    if (cumulative + count >= target) {
      // Interpolate within [2^i, 2^(i+1)) assuming uniform distribution.
      const lower = i === 0 ? MIN_DURATION_MS : 2 ** i;
      const upper = 2 ** (i + 1);
      const fraction = count > 0 ? (target - cumulative) / count : 0;
      return lower + fraction * (upper - lower);
    }
    cumulative += count;
  }
  return 0;
}

export function histogramEncode(histogram: Uint32Array): Buffer {
  const buf = Buffer.alloc(HISTOGRAM_BYTES);
  for (let i = 0; i < HISTOGRAM_BUCKETS; i++) buf.writeUInt32LE(histogram[i], i * BYTES_PER_BUCKET);
  return buf;
}

export function histogramDecode(data: Buffer | null | undefined): Uint32Array {
  const out = newHistogram();
  if (!data || data.length < HISTOGRAM_BYTES) return out;
  for (let i = 0; i < HISTOGRAM_BUCKETS; i++) {
    out[i] = data.readUInt32LE(i * BYTES_PER_BUCKET);
  }
  return out;
}

/**
 * Output and argument helpers shared across CLI commands. The brief endpoints
 * do all the shaping server-side now, so the CLI just emits whatever JSON the
 * server returned.
 */
export function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function clampToRange(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

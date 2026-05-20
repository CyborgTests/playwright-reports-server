/**
 * Output helpers. The brief endpoints do all the shaping server-side now, so
 * the CLI just emits whatever JSON the server returned.
 */
export function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Identifies error messages that are too generic to cluster on by signature
 * alone. A signature like "Test timeout of Nms exceeded" collapses tens of
 * unrelated failures into one cluster because the digit/quoted-string
 * normalizer in `computeErrorSignature` wipes out every distinguishing token.
 *
 * Runs that match these patterns are *not* excluded from clustering — they
 * can still be grouped by stack-frame, fixture, or temporal strategies, where
 * the signal is more meaningful. They are only excluded from the
 * signature-strategy bucket.
 */

const GENERIC_MESSAGE_PATTERNS: RegExp[] = [
  // Playwright's built-in timeout messages — high-volume, low-information.
  /^Test timeout of \d+ms exceeded\b/i,
  /^Test finished within timeout of \d+ms, but tearing down/i,
  /\b(?:page\.goto|locator\.\w+|waitForSelector): Timeout \d+ms exceeded\b/i,
  /^Timed out \d+ms waiting for /i,
  // Hook timeouts without phase markers (still generic on their own; the
  // fixture strategy handles the cases where the phase is explicit).
  /^Hook timed out\b/i,
  // Bare Error with no detail — happens when an exception is rethrown without
  // a message. Provides no clustering signal.
  /^Error:?\s*$/,
];

export function isGenericMessage(message: string | undefined): boolean {
  if (!message) return true;
  const trimmed = message.trim();
  if (trimmed.length === 0) return true;
  // Match against the first line only — Playwright timeout messages have a
  // detailed stack/context dump after the headline, which we don't want to
  // make the message look "specific" just because it's long.
  const firstLine = trimmed.split('\n')[0];
  return GENERIC_MESSAGE_PATTERNS.some((re) => re.test(firstLine));
}

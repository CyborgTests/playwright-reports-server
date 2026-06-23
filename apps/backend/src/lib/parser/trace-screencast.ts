import jpeg from 'jpeg-js';
import type { ScreencastFrame } from './trace-snapshot.js';
import type { TraceZip } from './trace-zip.js';

type FrameMeta = ScreencastFrame;

export interface ScreencastImage {
  data: string;
  mediaType: string;
  timestamp: number;
  label: string;
}

export interface ScreencastSelection {
  failingAction?: { before?: number; after?: number };
  series?: boolean;
  max: number;
}

interface Chosen {
  frame: FrameMeta;
  label: string;
}

const MAX_FRAME_BYTES = 2 * 1024 * 1024;

function frameAtOrBefore(frames: FrameMeta[], ts: number): FrameMeta {
  let result = frames[0];
  for (const f of frames) {
    if (f.timestamp <= ts) result = f;
    else break;
  }
  return result;
}

function frameAtOrAfter(frames: FrameMeta[], ts: number): FrameMeta {
  for (const f of frames) {
    if (f.timestamp >= ts) return f;
  }
  return frames[frames.length - 1];
}

function selectAroundAction(frames: FrameMeta[], before?: number, after?: number): Chosen[] {
  const chosen: Chosen[] = [];
  if (before != null)
    chosen.push({ frame: frameAtOrBefore(frames, before), label: 'before failed action' });
  if (after != null) {
    const f = frameAtOrAfter(frames, after);
    if (f !== chosen[0]?.frame) chosen.push({ frame: f, label: 'after failed action' });
  }
  if (chosen.length === 0) {
    chosen.push({ frame: frames[frames.length - 1], label: 'final frame' });
  }
  return chosen;
}

const SERIES_MAX_SCAN = 40;
// dHash is a 64-bit (DHASH_H × (DHASH_W-1)) perceptual hash; this many differing
// bits marks a "real" visual change (lower = more sensitive).
const SERIES_DHASH_THRESHOLD = 6;
const DHASH_W = 9;
const DHASH_H = 8;

function sampleEven(frames: FrameMeta[], n: number): FrameMeta[] {
  if (frames.length <= n) return frames;
  const out: FrameMeta[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * (frames.length - 1)) / (n - 1));
    if (!seen.has(idx)) {
      seen.add(idx);
      out.push(frames[idx]);
    }
  }
  return out;
}

/** Perceptual difference hash from a JPEG buffer (decode → 9×8 grayscale → compare
 *  horizontally adjacent cells). Returns 64 bits, or null if decoding fails. */
function dHash(buf: Buffer): boolean[] | null {
  let img: { width: number; height: number; data: Uint8Array };
  try {
    img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 256 });
  } catch {
    return null;
  }
  if (!img.width || !img.height) return null;
  const { data, width, height } = img;
  const gray = new Array<number>(DHASH_W * DHASH_H);
  for (let cy = 0; cy < DHASH_H; cy++) {
    for (let cx = 0; cx < DHASH_W; cx++) {
      const px = Math.min(width - 1, Math.floor((cx * width) / DHASH_W));
      const py = Math.min(height - 1, Math.floor((cy * height) / DHASH_H));
      const i = (py * width + px) * 4;
      gray[cy * DHASH_W + cx] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
  }
  const bits: boolean[] = [];
  for (let y = 0; y < DHASH_H; y++) {
    for (let x = 0; x < DHASH_W - 1; x++) {
      bits.push(gray[y * DHASH_W + x] < gray[y * DHASH_W + x + 1]);
    }
  }
  return bits;
}

function hammingDistance(a: boolean[], b: boolean[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

interface SeriesPoint {
  novelty: number; // min dHash distance to any already-kept frame (higher = more distinct)
  hash: boolean[];
  image: ScreencastImage;
}

function selectMeaningful(points: SeriesPoint[], budget: number): ScreencastImage[] {
  if (budget <= 0) return [];
  if (points.length <= budget) return points.map((p) => p.image);
  const keep = new Set<number>([points.length - 1]); // nearest the failure
  if (budget >= 2) keep.add(0); // initial state
  const rest = points
    .map((_, i) => i)
    .filter((i) => !keep.has(i))
    .sort((a, b) => points[b].novelty - points[a].novelty);
  for (const i of rest) {
    if (keep.size >= budget) break;
    keep.add(i);
  }
  return [...keep].sort((a, b) => a - b).map((i) => points[i].image);
}

export async function extractScreencastImages(
  directory: TraceZip,
  frames: FrameMeta[],
  sel: ScreencastSelection
): Promise<ScreencastImage[]> {
  try {
    if (frames.length === 0) return [];

    const byPath = new Map(directory.files.map((f) => [f.path, f] as const));
    const readBuf = async (sha1: string): Promise<Buffer | null> => {
      const entry =
        byPath.get(`resources/${sha1}`) ?? directory.files.find((f) => f.path.endsWith(sha1));
      if (!entry) return null;
      const buf = await entry.buffer();
      return buf.length === 0 || buf.length > MAX_FRAME_BYTES ? null : buf;
    };
    const toImage = (frame: FrameMeta, label: string, buf: Buffer): ScreencastImage => ({
      data: buf.toString('base64'),
      mediaType: frame.sha1.endsWith('.png') ? 'image/png' : 'image/jpeg',
      timestamp: frame.timestamp,
      label,
    });

    const t0 = frames[0].timestamp;
    const ms = (frame: FrameMeta) => Math.round(frame.timestamp - t0);
    const out: ScreencastImage[] = [];
    const usedSha = new Set<string>();
    // Perceptual hashes of every frame already kept (across BOTH sources), so we
    // never send two visually-near-identical frames (e.g. a stuck spinner or
    // failure + before + after + series all look the same).
    const keptHashes: boolean[][] = [];
    const tooSimilar = (h: boolean[] | null): boolean =>
      !!h && keptHashes.some((k) => hammingDistance(h, k) < SERIES_DHASH_THRESHOLD);

    // failing_action anchors the failure moment: before/after the failing action,
    // labelled with their timing. 'after' is dropped when it's identical to 'before'
    // (the action had no visible effect - the DOM-effect block already says so).
    if (sel.failingAction) {
      for (const c of selectAroundAction(
        frames,
        sel.failingAction.before,
        sel.failingAction.after
      )) {
        if (out.length >= sel.max) break;
        if (usedSha.has(c.frame.sha1)) continue;
        const buf = await readBuf(c.frame.sha1);
        if (!buf) continue;
        const hash = dHash(buf);
        if (tooSimilar(hash)) continue;
        usedSha.add(c.frame.sha1);
        if (hash) keptHashes.push(hash);
        out.push(toImage(c.frame, `${c.label} (t+${ms(c.frame)}ms)`, buf));
      }
    }

    // series: only frames visually DISTINCT from everything kept so far (the
    // anchors above + each other), so it adds *new* states rather than repeating
    // the failure/before/after frame. Ranked by novelty (distance to nearest kept).
    if (sel.series && out.length < sel.max) {
      const points: SeriesPoint[] = [];
      for (const f of sampleEven(frames, SERIES_MAX_SCAN)) {
        if (usedSha.has(f.sha1)) continue;
        const buf = await readBuf(f.sha1);
        if (!buf) continue;
        const hash = dHash(buf);
        if (!hash) continue;
        let novelty = Number.POSITIVE_INFINITY;
        for (const k of keptHashes) novelty = Math.min(novelty, hammingDistance(hash, k));
        for (const p of points) novelty = Math.min(novelty, hammingDistance(hash, p.hash));
        if (novelty < SERIES_DHASH_THRESHOLD) continue; // not distinct from what we already have
        usedSha.add(f.sha1);
        points.push({
          novelty,
          hash,
          image: toImage(f, `frame (t+${ms(f)}ms)`, buf),
        });
      }
      for (const img of selectMeaningful(points, sel.max - out.length)) out.push(img);
    }

    return out;
  } catch (err) {
    console.warn(
      `[trace-screencast] failed to extract frames: ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }
}

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Open } from 'unzipper';
import { REPORTS_FOLDER } from '../storage/constants.js';

export type NodeSnapshot = string | unknown[];

export type RawChild = RawDomNode | string;

export interface RawDomNode {
  tag: string;
  attrs: Record<string, string>;
  children: RawChild[];
}

export interface FrameSnapshotRaw {
  frameId: string;
  isMainFrame: boolean;
  snapshotName: string;
  kind?: 'before' | 'after' | 'action' | 'event';
  callId?: string;
  html: NodeSnapshot;
  timestamp?: number;
}

export interface TraceSnapshots {
  byFrame: Map<string, FrameSnapshotRaw[]>;
  mainFrameId?: string;
  failingCallId?: string;
}

const MAX_RECONSTRUCT_NODES = 20000;

function isReference(node: unknown[]): boolean {
  return node.length > 0 && Array.isArray(node[0]);
}

function isElement(node: unknown[]): boolean {
  return node.length > 0 && typeof node[0] === 'string';
}

function elementAttrs(node: unknown[]): { attrs: Record<string, string>; childStart: number } {
  const maybe = node[1];
  if (maybe && typeof maybe === 'object' && !Array.isArray(maybe)) {
    return { attrs: maybe as Record<string, string>, childStart: 2 };
  }
  return { attrs: {}, childStart: 1 };
}

function buildFlatNodes(html: NodeSnapshot): NodeSnapshot[] {
  const out: NodeSnapshot[] = [];
  const visit = (n: NodeSnapshot): void => {
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (!Array.isArray(n)) return;
    if (isReference(n)) return; // references are neither emitted nor descended
    if (isElement(n)) {
      out.push(n);
      const { childStart } = elementAttrs(n);
      for (let i = childStart; i < n.length; i++) visit(n[i] as NodeSnapshot);
    }
  };
  visit(html);
  return out;
}

export function reconstructDom(frameSnaps: FrameSnapshotRaw[], index: number): RawDomNode | null {
  if (index < 0 || index >= frameSnaps.length) return null;
  const flatCache = new Map<number, NodeSnapshot[]>();
  const flatFor = (i: number): NodeSnapshot[] => {
    let cached = flatCache.get(i);
    if (!cached) {
      cached = buildFlatNodes(frameSnaps[i].html);
      flatCache.set(i, cached);
    }
    return cached;
  };

  let budget = MAX_RECONSTRUCT_NODES;

  const render = (node: NodeSnapshot, snapIdx: number): RawChild | null => {
    if (budget-- <= 0) return null;
    if (typeof node === 'string') return node;
    if (!Array.isArray(node)) return null;

    if (isReference(node)) {
      const ref = node[0] as unknown[];
      const distance = typeof ref[0] === 'number' ? ref[0] : NaN;
      const nodeIndex = typeof ref[1] === 'number' ? ref[1] : NaN;
      if (Number.isNaN(distance) || Number.isNaN(nodeIndex)) return null;
      const refIdx = snapIdx - distance;
      if (refIdx < 0 || refIdx >= frameSnaps.length) return null;
      const target = flatFor(refIdx)[nodeIndex];
      if (target === undefined) return null;
      return render(target, refIdx);
    }

    if (isElement(node)) {
      const tag = (node[0] as string).toUpperCase();
      const { attrs, childStart } = elementAttrs(node);
      const children: RawChild[] = [];
      for (let i = childStart; i < node.length; i++) {
        const child = render(node[i] as NodeSnapshot, snapIdx);
        if (child !== null) children.push(child);
      }
      return { tag, attrs, children };
    }
    return null;
  };

  const root = render(frameSnaps[index].html, index);
  return root && typeof root !== 'string' ? root : null;
}

function parseSnapshotName(name: string): { kind?: FrameSnapshotRaw['kind']; callId?: string } {
  const at = name.indexOf('@');
  if (at < 0) return {};
  const kind = name.slice(0, at);
  const callId = name.slice(at + 1);
  if (kind === 'before' || kind === 'after' || kind === 'action' || kind === 'event') {
    return { kind, callId };
  }
  return {};
}

interface TraceEntry {
  type?: string;
  callId?: string;
  error?: unknown;
  snapshot?: {
    snapshotName?: string;
    frameId?: string;
    isMainFrame?: boolean;
    html?: NodeSnapshot;
    timestamp?: number;
  };
}

export async function parseTraceSnapshots(
  reportId: string,
  tracePath: string
): Promise<TraceSnapshots | null> {
  try {
    const zipBuffer = await fs.readFile(path.join(REPORTS_FOLDER, reportId, tracePath));
    const directory = await Open.buffer(zipBuffer);
    const traceFiles = directory.files.filter(
      (f) => f.type === 'File' && f.path.endsWith('.trace')
    );

    const byFrame = new Map<string, FrameSnapshotRaw[]>();
    let mainFrameId: string | undefined;
    const erroredCallIds: string[] = [];
    const snapshotCallIds = new Set<string>();

    for (const file of traceFiles) {
      const content = (await file.buffer()).toString('utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let entry: TraceEntry;
        try {
          entry = JSON.parse(trimmed) as TraceEntry;
        } catch {
          continue;
        }

        if (entry.error && entry.callId) erroredCallIds.push(entry.callId);

        const s = entry.snapshot;
        if (entry.type !== 'frame-snapshot' || !s?.html) continue;
        const frameId = s.frameId ?? 'main';
        const { kind, callId } = parseSnapshotName(s.snapshotName ?? '');
        if (callId) snapshotCallIds.add(callId);
        const snap: FrameSnapshotRaw = {
          frameId,
          isMainFrame: !!s.isMainFrame,
          snapshotName: s.snapshotName ?? '',
          kind,
          callId,
          html: s.html,
          timestamp: s.timestamp,
        };
        if (snap.isMainFrame && !mainFrameId) mainFrameId = frameId;
        const list = byFrame.get(frameId);
        if (list) list.push(snap);
        else byFrame.set(frameId, [snap]);
      }
    }

    if (byFrame.size === 0) return null;
    let failingCallId = [...erroredCallIds].reverse().find((id) => snapshotCallIds.has(id));
    if (!failingCallId) failingCallId = lastActionWithBeforeAfter(byFrame, mainFrameId);

    return { byFrame, mainFrameId, failingCallId };
  } catch (error) {
    console.error(`[trace-snapshot] Failed to read snapshots ${tracePath}:`, error);
    return null;
  }
}

function lastActionWithBeforeAfter(
  byFrame: Map<string, FrameSnapshotRaw[]>,
  mainFrameId: string | undefined
): string | undefined {
  const snaps = mainFrameId ? byFrame.get(mainFrameId) : undefined;
  if (!snaps) return undefined;
  const before = new Set<string>();
  const after = new Set<string>();
  for (const s of snaps) {
    if (!s.callId) continue;
    if (s.kind === 'before') before.add(s.callId);
    else if (s.kind === 'after') after.add(s.callId);
  }
  let result: string | undefined;
  for (const s of snaps) {
    if (s.callId && before.has(s.callId) && after.has(s.callId)) result = s.callId;
  }
  return result;
}

function mainFrameSnaps(ts: TraceSnapshots): FrameSnapshotRaw[] | undefined {
  if (ts.mainFrameId) return ts.byFrame.get(ts.mainFrameId);
  let best: FrameSnapshotRaw[] | undefined;
  for (const list of ts.byFrame.values()) {
    if (!best || list.length > best.length) best = list;
  }
  return best;
}

function nodeCount(node: RawDomNode): number {
  let n = 1;
  for (const child of node.children) {
    if (typeof child !== 'string') n += nodeCount(child);
  }
  return n;
}

export function richestMainFrameDom(ts: TraceSnapshots): RawDomNode | null {
  const snaps = mainFrameSnaps(ts);
  if (!snaps || snaps.length === 0) return null;
  let best: RawDomNode | null = null;
  let bestSize = 0;
  for (let i = 0; i < snaps.length; i++) {
    const dom = reconstructDom(snaps, i);
    if (!dom) continue;
    const size = nodeCount(dom);
    if (size > bestSize) {
      best = dom;
      bestSize = size;
    }
  }
  return best;
}

export function failureDom(ts: TraceSnapshots): RawDomNode | null {
  if (ts.failingCallId) {
    const { after } = actionBeforeAfterDom(ts, ts.failingCallId);
    if (after && nodeCount(after) > 3) return after;
  }
  return richestMainFrameDom(ts);
}

export function actionBeforeAfterDom(
  ts: TraceSnapshots,
  callId: string
): { before: RawDomNode | null; after: RawDomNode | null } {
  const snaps = mainFrameSnaps(ts);
  if (!snaps) return { before: null, after: null };
  const beforeIdx = snaps.findIndex((s) => s.kind === 'before' && s.callId === callId);
  const afterIdx = snaps.findIndex((s) => s.kind === 'after' && s.callId === callId);
  return {
    before: beforeIdx >= 0 ? reconstructDom(snaps, beforeIdx) : null,
    after: afterIdx >= 0 ? reconstructDom(snaps, afterIdx) : null,
  };
}

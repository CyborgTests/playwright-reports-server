import type { NetworkDiff, NetworkDiffEntry, NetworkDiffKind } from '@playwright-reports/shared';
import type { NetworkEvent } from '../parser/failure-extraction.js';

const DEFAULT_MAX_ENTRIES = 20;

const KIND_RANK: Record<NetworkDiffKind, number> = {
  'now-failing': 0,
  'status-changed': 1,
  added: 2,
  removed: 3,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX_RE = /^[0-9a-f]{16,}$/i;

function maskSegment(seg: string): string {
  if (seg === '') return seg;
  if (/^\d+$/.test(seg)) return ':id';
  if (UUID_RE.test(seg)) return ':id';
  if (LONG_HEX_RE.test(seg)) return ':id';
  return seg;
}

export function normalizeUrl(raw: string): string {
  const stripQuery = (s: string): string => s.split('#')[0].split('?')[0];
  try {
    const u = new URL(raw);
    const path = u.pathname.split('/').map(maskSegment).join('/');
    return `${u.host}${path}`;
  } catch {
    return stripQuery(raw);
  }
}

function requestKey(method: string, url: string): string {
  return `${method.toUpperCase()} ${normalizeUrl(url)}`;
}

function isFailing(ev: { status?: number; failureText?: string; pending?: boolean }): boolean {
  return (
    !!ev.failureText || ev.pending === true || (typeof ev.status === 'number' && ev.status >= 400)
  );
}

function statusClass(status: number | undefined): number | undefined {
  if (typeof status !== 'number') return undefined;
  return Math.floor(status / 100);
}

interface Aggregate {
  method: string;
  url: string;
  status?: number;
  failureText?: string;
  failed: boolean;
}

function aggregate(events: NetworkEvent[]): Map<string, Aggregate> {
  const map = new Map<string, Aggregate>();
  for (const ev of events) {
    const key = requestKey(ev.method, ev.url);
    const failed = isFailing(ev);
    const failureText = ev.failureText ?? (ev.pending ? 'no response (in-flight)' : undefined);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        method: ev.method.toUpperCase(),
        url: normalizeUrl(ev.url),
        status: ev.status,
        failureText,
        failed,
      });
      continue;
    }
    if (failed && !existing.failed) {
      existing.failed = true;
      existing.status = ev.status;
      existing.failureText = failureText;
    } else if (!existing.failed) {
      existing.status = ev.status;
    }
  }
  return map;
}

export interface NetworkDiffOptions {
  maxEntries?: number;
}

export function computeNetworkDiff(
  baseline: NetworkEvent[],
  current: NetworkEvent[],
  options: NetworkDiffOptions = {}
): NetworkDiff {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const base = aggregate(baseline);
  const curr = aggregate(current);

  const entries: NetworkDiffEntry[] = [];

  for (const [key, c] of curr) {
    const b = base.get(key);
    if (!b) {
      entries.push({
        kind: 'added',
        method: c.method,
        url: c.url,
        currentStatus: c.status,
        failureText: c.failureText,
      });
      continue;
    }
    const cFailing = c.failed;
    const bFailing = b.failed;
    if (cFailing && !bFailing) {
      entries.push({
        kind: 'now-failing',
        method: c.method,
        url: c.url,
        baselineStatus: b.status,
        currentStatus: c.status,
        failureText: c.failureText,
      });
    } else if (statusClass(b.status) !== statusClass(c.status)) {
      entries.push({
        kind: 'status-changed',
        method: c.method,
        url: c.url,
        baselineStatus: b.status,
        currentStatus: c.status,
        failureText: c.failureText,
      });
    }
  }

  for (const [key, b] of base) {
    if (!curr.has(key)) {
      entries.push({
        kind: 'removed',
        method: b.method,
        url: b.url,
        baselineStatus: b.status,
      });
    }
  }

  entries.sort((a, z) => {
    const r = KIND_RANK[a.kind] - KIND_RANK[z.kind];
    if (r !== 0) return r;
    return `${a.method} ${a.url}`.localeCompare(`${z.method} ${z.url}`);
  });

  const omitted = Math.max(0, entries.length - maxEntries);
  return {
    entries: omitted > 0 ? entries.slice(0, maxEntries) : entries,
    baselineCount: base.size,
    currentCount: curr.size,
    omitted,
  };
}

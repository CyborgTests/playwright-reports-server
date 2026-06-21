import type { DomChangeKind, DomDiff, DomDiffEntry } from '@playwright-reports/shared';
import { collectVisibleText, type DomNode } from '../parser/domNormalize.js';

const DEFAULT_MAX_ENTRIES = 20;
const DEFAULT_MAX_TEXT = 6;
const DETAIL_MAX = 160;

const KIND_RANK: Record<DomChangeKind, number> = {
  added: 0,
  removed: 1,
  'text-changed': 2,
  'attr-changed': 3,
};

const INTERESTING_TAGS = new Set([
  'A',
  'BUTTON',
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'FORM',
  'LABEL',
  'IMG',
  'CANVAS',
  'IFRAME',
  'DIALOG',
  'TABLE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
]);

function truncate(s: string): string {
  return s.length > DETAIL_MAX ? `${s.slice(0, DETAIL_MAX - 1)}…` : s;
}

function nodeLabel(node: DomNode): string {
  return node.key ? `${node.tag}[${node.key}]` : node.tag;
}

// Bare anonymous DIV/SPAN wrappers add no signal; only report nodes with identity.
function isInformative(node: DomNode): boolean {
  return !!node.key || !!node.text || INTERESTING_TAGS.has(node.tag.toUpperCase());
}

// Collapse runs of identical anonymous (unkeyed) path segments: a long DIV>DIV>DIV...>DIV
// chain becomes DIV×N, so deep paths stop dominating the output with no added signal.
function compactPath(path: string): string {
  const parts = path.split('>');
  const out: string[] = [];
  for (let i = 0; i < parts.length; ) {
    const seg = parts[i];
    let j = i + 1;
    if (!seg.includes('[')) while (j < parts.length && parts[j] === seg) j++;
    const run = j - i;
    out.push(run >= 2 ? `${seg}×${run}` : seg);
    i = j;
  }
  return out.join('>');
}

function childIdentities(children: DomNode[]): Map<string, DomNode> {
  const map = new Map<string, DomNode>();
  const tagCounts = new Map<string, number>();
  for (const child of children) {
    let id: string;
    if (child.key) {
      id = `k:${child.key}`;
      if (map.has(id)) {
        let n = 2;
        while (map.has(`${id}#${n}`)) n++;
        id = `${id}#${n}`;
      }
    } else {
      const n = (tagCounts.get(child.tag) ?? 0) + 1;
      tagCounts.set(child.tag, n);
      id = `t:${child.tag}#${n}`;
    }
    map.set(id, child);
  }
  return map;
}

function attrsDiffer(a: Record<string, string>, b: Record<string, string>): string | null {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changes: string[] = [];
  for (const k of [...keys].sort()) {
    if (a[k] !== b[k]) changes.push(`${k}: ${a[k] ?? '∅'} -> ${b[k] ?? '∅'}`);
  }
  return changes.length > 0 ? changes.join('; ') : null;
}

export interface DomDiffOptions {
  maxEntries?: number;
  maxText?: number;
}

export function computeDomDiff(
  baseline: DomNode,
  current: DomNode,
  options: DomDiffOptions = {}
): DomDiff {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxText = options.maxText ?? DEFAULT_MAX_TEXT;
  const entries: DomDiffEntry[] = [];

  const walk = (b: DomNode, c: DomNode, path: string): void => {
    if (b.text !== c.text && (b.text || c.text)) {
      entries.push({
        kind: 'text-changed',
        path,
        detail: truncate(`"${b.text}" -> "${c.text}"`),
      });
    }
    const attrChange = attrsDiffer(b.attrs, c.attrs);
    if (attrChange) {
      entries.push({ kind: 'attr-changed', path, detail: truncate(attrChange) });
    }

    const bKids = childIdentities(b.children);
    const cKids = childIdentities(c.children);
    for (const [id, child] of cKids) {
      if (!bKids.has(id) && isInformative(child)) {
        const childPath = `${path}>${nodeLabel(child)}`;
        const summary = child.text ? truncate(`text "${child.text}"`) : undefined;
        entries.push({ kind: 'added', path: childPath, detail: summary });
      }
    }
    for (const [id, child] of bKids) {
      if (!cKids.has(id) && isInformative(child)) {
        entries.push({ kind: 'removed', path: `${path}>${nodeLabel(child)}` });
      }
    }
    for (const [id, child] of cKids) {
      const prev = bKids.get(id);
      if (prev) walk(prev, child, `${path}>${nodeLabel(child)}`);
    }
  };

  walk(baseline, current, nodeLabel(current));

  entries.sort((a, z) => {
    const r = KIND_RANK[a.kind] - KIND_RANK[z.kind];
    if (r !== 0) return r;
    return a.path.localeCompare(z.path);
  });

  const bText = new Set(collectVisibleText(baseline));
  const cText = new Set(collectVisibleText(current));
  const textAdded: string[] = [];
  const textRemoved: string[] = [];
  for (const t of cText) if (!bText.has(t)) textAdded.push(t);
  for (const t of bText) if (!cText.has(t)) textRemoved.push(t);

  const omitted = Math.max(0, entries.length - maxEntries);
  const kept = (omitted > 0 ? entries.slice(0, maxEntries) : entries).map((e) => ({
    ...e,
    path: compactPath(e.path),
  }));
  return {
    entries: kept,
    textAdded: textAdded.slice(0, maxText),
    textRemoved: textRemoved.slice(0, maxText),
    omitted,
    textAddedOmitted: Math.max(0, textAdded.length - maxText),
    textRemovedOmitted: Math.max(0, textRemoved.length - maxText),
  };
}

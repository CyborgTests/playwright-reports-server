import type { RawChild, RawDomNode } from './trace-snapshot.js';

export interface DomNode {
  tag: string;
  key?: string;
  attrs: Record<string, string>;
  text: string;
  children: DomNode[];
}

const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'LINK',
  'META',
  'TEMPLATE',
  'BASE',
  'HEAD',
]);

const LEAF_TAGS = new Set(['SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME']);

const SALIENT_ATTRS = new Set([
  'role',
  'type',
  'name',
  'href',
  'src',
  'alt',
  'title',
  'placeholder',
  'value',
  'for',
  'aria-label',
  'aria-hidden',
  'aria-expanded',
  'aria-disabled',
  'aria-selected',
  'aria-checked',
  'disabled',
  'checked',
  'selected',
  'open',
  'hidden',
  'contenteditable',
]);

const KEY_ATTRS = ['data-testid', 'data-test', 'data-test-id', 'id', 'name'];

const TEXT_MAX = 200;

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function normalizeAttrValue(name: string, value: string): string {
  if ((name === 'href' || name === 'src') && value) {
    return value.split('#')[0].split('?')[0];
  }
  return collapseWs(value).slice(0, TEXT_MAX);
}

function pickKey(attrs: Record<string, string>): string | undefined {
  for (const k of KEY_ATTRS) {
    const v = attrs[k];
    if (v?.trim()) return `${k}=${collapseWs(v)}`;
  }
  return undefined;
}

function pickSalientAttrs(attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    const lower = k.toLowerCase();
    if (SALIENT_ATTRS.has(lower)) out[lower] = normalizeAttrValue(lower, v);
  }
  return out;
}

export function normalizeDom(raw: RawDomNode): DomNode | null {
  const visit = (node: RawDomNode): DomNode | null => {
    if (SKIP_TAGS.has(node.tag)) return null;

    const attrs = node.attrs ?? {};
    const directText: string[] = [];
    const children: DomNode[] = [];

    if (!LEAF_TAGS.has(node.tag)) {
      for (const child of node.children as RawChild[]) {
        if (typeof child === 'string') {
          const t = collapseWs(child);
          if (t) directText.push(t);
        } else {
          const norm = visit(child);
          if (norm) children.push(norm);
        }
      }
    }

    return {
      tag: node.tag,
      key: pickKey(attrs),
      attrs: pickSalientAttrs(attrs),
      text: directText.join(' ').slice(0, TEXT_MAX),
      children,
    };
  };
  return visit(raw);
}

export function collectVisibleText(node: DomNode): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const walk = (n: DomNode): void => {
    if (n.text && !seen.has(n.text)) {
      seen.add(n.text);
      out.push(n.text);
    }
    for (const c of n.children) walk(c);
  };
  walk(node);
  return out;
}

import type { Element, ElementContent, Root } from 'hast';
import bash from 'highlight.js/lib/languages/bash';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import { createLowlight } from 'lowlight';
import { visit } from 'unist-util-visit';

const lowlight = createLowlight();
lowlight.register({ bash, javascript, typescript });

const HLJS_CLASS = 'hljs';
const PREFIX = 'hljs-';

function readLanguage(node: Element): string | false | undefined {
  const list = node.properties?.className;
  if (!Array.isArray(list)) return undefined;
  for (const raw of list) {
    const value = String(raw);
    if (value === 'no-highlight' || value === 'nohighlight') return false;
    if (value.startsWith('language-')) return value.slice(9);
    if (value.startsWith('lang-')) return value.slice(5);
  }
  return undefined;
}

function nodeToText(node: Element): string {
  let out = '';
  const walk = (n: ElementContent) => {
    if (n.type === 'text') out += n.value;
    else if (n.type === 'element') for (const child of n.children) walk(child);
  };
  for (const child of node.children) walk(child);
  return out;
}

export function rehypeHighlightMini() {
  return (tree: Root) => {
    visit(tree, 'element', (node, _index, parent) => {
      if (
        node.tagName !== 'code' ||
        !parent ||
        parent.type !== 'element' ||
        (parent as Element).tagName !== 'pre'
      ) {
        return;
      }

      const lang = readLanguage(node);
      if (lang === false || !lang) return;
      if (!lowlight.registered(lang)) return;

      const code = nodeToText(node);
      let result: Root;
      try {
        result = lowlight.highlight(lang, code, { prefix: PREFIX });
      } catch {
        return;
      }

      const className = Array.isArray(node.properties.className)
        ? [...node.properties.className]
        : [];
      if (!className.includes(HLJS_CLASS)) className.unshift(HLJS_CLASS);
      node.properties.className = className;

      if (result.children.length > 0) {
        node.children = result.children as ElementContent[];
      }
    });
  };
}

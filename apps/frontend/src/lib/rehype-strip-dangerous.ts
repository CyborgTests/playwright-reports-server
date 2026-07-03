import type { Element, Root } from 'hast';
import { SKIP, visit } from 'unist-util-visit';

// drop unsafe element nodes and any external URL attributes
const DANGEROUS_TAGS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'style',
  'link',
  'base',
  'meta',
  'template',
]);

const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href']);

function isDangerousUrl(value: unknown): boolean {
  return typeof value === 'string' && /^\s*(javascript|data|vbscript):/i.test(value);
}

export function rehypeStripDangerous() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (DANGEROUS_TAGS.has(node.tagName) && parent && typeof index === 'number') {
        parent.children.splice(index, 1);
        return [SKIP, index];
      }
      if (node.properties) {
        for (const key of Object.keys(node.properties)) {
          const lower = key.toLowerCase();
          if (lower.startsWith('on') || lower === 'style') {
            delete node.properties[key];
          } else if (URL_ATTRS.has(lower) && isDangerousUrl(node.properties[key])) {
            delete node.properties[key];
          }
        }
      }
      return undefined;
    });
  };
}

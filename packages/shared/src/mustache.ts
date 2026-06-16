/**
 * Section-aware Mustache renderer for chat-message templates, shared by the
 * notification dispatcher and the rule-editor live preview. Supported subset:
 *
 *   {{var}}            — substitution (allowlist-aware)
 *   {{.}}              — current section value (when iterating)
 *   {{#var}}…{{/var}}  — section: truthy primitive renders body once with the
 *                        value on the stack; object pushes it; array iterates.
 *   {{^var}}…{{/var}}  — inverted: render when falsy / empty array / missing.
 *   {{!comment}}       — ignored.
 *
 * Excluded: partials, unescaped `{{{ }}}`, delimiter changes, lambdas.
 * Provider-specific escaping (Slack mrkdwn, JSON) lives in the `transform` option.
 */

type Node =
  | { kind: 'text'; value: string }
  | { kind: 'var'; name: string }
  | { kind: 'section'; name: string; inverted: boolean; children: Node[] };

export class MustacheParseError extends Error {
  constructor(
    message: string,
    public readonly position: number
  ) {
    super(message);
    this.name = 'MustacheParseError';
  }
}

const TAG = /\{\{\s*([#^/!]?)\s*([^}]*?)\s*\}\}/g;
const MAX_SECTION_DEPTH = 32;

export function parseTemplate(template: string): Node[] {
  const root: Node[] = [];
  const frames: Array<{ name: string | null; nodes: Node[] }> = [{ name: null, nodes: root }];

  let lastIndex = 0;
  TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex walk
  while ((match = TAG.exec(template)) !== null) {
    if (match.index > lastIndex) {
      frames[frames.length - 1].nodes.push({
        kind: 'text',
        value: template.slice(lastIndex, match.index),
      });
    }
    const [full, sigil, rawName] = match;
    const name = rawName.trim();
    lastIndex = match.index + full.length;

    if (sigil === '!') continue;
    if (sigil === '#' || sigil === '^') {
      if (!name) throw new MustacheParseError('Empty section name', match.index);
      if (frames.length > MAX_SECTION_DEPTH) {
        throw new MustacheParseError(
          `Section nesting exceeds ${MAX_SECTION_DEPTH} — refusing to parse`,
          match.index
        );
      }
      const section: Node = { kind: 'section', name, inverted: sigil === '^', children: [] };
      frames[frames.length - 1].nodes.push(section);
      frames.push({ name, nodes: section.children });
      continue;
    }
    if (sigil === '/') {
      const open = frames[frames.length - 1];
      if (frames.length === 1) {
        throw new MustacheParseError(
          `Unexpected closing tag "{{/${name}}}" — no matching open`,
          match.index
        );
      }
      if (open.name !== name) {
        throw new MustacheParseError(
          `Mismatched closing tag: expected "{{/${open.name}}}", got "{{/${name}}}"`,
          match.index
        );
      }
      frames.pop();
      continue;
    }

    frames[frames.length - 1].nodes.push({ kind: 'var', name: name || '.' });
  }

  if (lastIndex < template.length) {
    frames[frames.length - 1].nodes.push({ kind: 'text', value: template.slice(lastIndex) });
  }

  if (frames.length > 1) {
    throw new MustacheParseError(
      `Unclosed section "{{#${frames[frames.length - 1].name}}}"`,
      template.length
    );
  }

  return root;
}

type ContextValue = unknown;
type Context = Record<string, ContextValue>;

export interface RenderOptions {
  allowlist?: ReadonlySet<string>;
  transform?: (value: ContextValue) => string;
}

export interface RenderResult {
  output: string;
  warnings: string[];
}

const DOT = '.';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function defaultStringify(value: ContextValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function isInPushedFrame(name: string, stack: ContextValue[]): boolean {
  for (let i = stack.length - 1; i > 0; i--) {
    const frame = stack[i];
    if (isPlainObject(frame) && name in frame) return true;
  }
  return false;
}

function resolve(name: string, stack: ContextValue[]): ContextValue {
  if (name === DOT) return stack[stack.length - 1];
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i];
    if (isPlainObject(frame) && name in frame) {
      return frame[name];
    }
  }
  return undefined;
}

function isTruthy(value: ContextValue): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'string') return value.length > 0;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function renderNodes(
  nodes: Node[],
  stack: ContextValue[],
  options: RenderOptions,
  out: string[],
  warnings: string[],
  warnedNames: Set<string>
): void {
  const stringify = options.transform ?? defaultStringify;

  for (const node of nodes) {
    if (node.kind === 'text') {
      out.push(node.value);
      continue;
    }

    if (node.kind === 'var') {
      if (
        node.name !== DOT &&
        options.allowlist &&
        !options.allowlist.has(node.name) &&
        !isInPushedFrame(node.name, stack)
      ) {
        out.push(`{{${node.name}}}`);
        if (!warnedNames.has(node.name)) {
          warnedNames.add(node.name);
          warnings.push(`Unknown variable "${node.name}"`);
        }
        continue;
      }
      const value = resolve(node.name, stack);
      out.push(stringify(value));
      continue;
    }

    if (options.allowlist && !options.allowlist.has(node.name)) {
      if (!warnedNames.has(node.name)) {
        warnedNames.add(node.name);
        warnings.push(`Unknown section "${node.name}"`);
      }
      if (node.inverted) {
        renderNodes(node.children, stack, options, out, warnings, warnedNames);
      }
      continue;
    }

    const value = resolve(node.name, stack);
    const truthy = isTruthy(value);

    if (node.inverted) {
      if (!truthy) renderNodes(node.children, stack, options, out, warnings, warnedNames);
      continue;
    }

    if (!truthy) continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        stack.push(item);
        renderNodes(node.children, stack, options, out, warnings, warnedNames);
        stack.pop();
      }
    } else if (isPlainObject(value)) {
      stack.push(value);
      renderNodes(node.children, stack, options, out, warnings, warnedNames);
      stack.pop();
    } else {
      stack.push(value);
      renderNodes(node.children, stack, options, out, warnings, warnedNames);
      stack.pop();
    }
  }
}

export function renderTemplate(
  template: string,
  context: Context,
  options: RenderOptions = {}
): RenderResult {
  const ast = parseTemplate(template);
  const out: string[] = [];
  const warnings: string[] = [];
  const warnedNames = new Set<string>();
  renderNodes(ast, [context], options, out, warnings, warnedNames);
  return { output: out.join(''), warnings };
}

export function jsonValueEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value).slice(1, -1);
  return JSON.stringify(value);
}

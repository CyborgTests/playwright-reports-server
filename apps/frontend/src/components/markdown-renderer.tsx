import { isValidElement, memo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link as RouterLink } from 'react-router-dom';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { rehypeHighlightMini } from '@/lib/rehype-highlight-mini';
import { CopyButton } from './copy-button';
import { Badge } from './ui/badge';

const rehypePlugins = [rehypeHighlightMini, rehypeRaw];
const remarkPlugins = [remarkGfm];

/** Resolve a `pwrs:` URL (emitted by the LLM analyses for inline test/report
 *  refs) into a React Router path. Returns null for refs without an SPA
 *  navigation target — those render as styled labels instead of links so the
 *  user still sees the citation.
 *
 *  Test links carry the test's project in `?project=…`; the parser reads it
 *  out and re-emits it on the SPA URL so /test/:testId can scope its lookup.
 *  `fallbackProject` only applies when the URL omits the query (legacy
 *  markdown stored before per-link project encoding). */
function resolvePwrsHref(href: string, fallbackProject?: string): string | null {
  const m = href.match(/^pwrs:(test|report|cluster)\/(.+)$/);
  if (!m) return null;
  const [, kind, target] = m;
  if (kind === 'test') {
    const qIdx = target.indexOf('?');
    const pathPart = qIdx === -1 ? target : target.slice(0, qIdx);
    const queryStr = qIdx === -1 ? '' : target.slice(qIdx + 1);
    // /test/:testId — single URL-safe segment.
    if (!pathPart || pathPart.includes('/')) return null;
    let project: string | undefined;
    if (queryStr) {
      const params = new URLSearchParams(queryStr);
      const raw = params.get('project');
      if (raw) project = raw;
    }
    project = project ?? fallbackProject;
    const query = project ? `?project=${encodeURIComponent(project)}` : '';
    return `/test/${pathPart}${query}`;
  }
  if (kind === 'cluster') {
    if (!target || target.includes('/')) return null;
    return `/failures/clusters?clusterId=${encodeURIComponent(target)}`;
  }
  return `/report/${target}`;
}

/** react-markdown's default urlTransform sanitizes any non-http(s)/mailto/tel
 *  scheme by replacing the href with an empty string. Our pwrs: scheme would
 *  vanish before our `a` component runs, so allow it through here and let the
 *  component decide how to render. Default safe-scheme behavior is preserved
 *  for everything else. */
function urlTransform(value: string): string {
  if (typeof value === 'string' && value.startsWith('pwrs:')) return value;
  const colon = value.indexOf(':');
  const questionMark = value.indexOf('?');
  const numberSign = value.indexOf('#');
  const slash = value.indexOf('/');
  if (
    colon < 0 ||
    (slash > -1 && colon > slash) ||
    (questionMark > -1 && colon > questionMark) ||
    (numberSign > -1 && colon > numberSign) ||
    /^(?:https?|ircs?|mailto|xmpp|tel)$/i.test(value.slice(0, colon))
  ) {
    return value;
  }
  return '';
}

/** Recursively flatten a ReactNode tree to plain text. Needed because
 *  rehype-highlight wraps every code token in a `<span>` element, so
 *  `String(children)` would emit `[object Object],[object Object],…` for
 *  the copy button. */
function reactNodeToText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(reactNodeToText).join('');
  if (isValidElement(node)) {
    return reactNodeToText((node.props as { children?: ReactNode }).children);
  }
  return '';
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
  /** Scopes inline `pwrs:test/TID` links to a project, so the test detail
   *  page can find the right (testId, project) row. Pass the project the
   *  surrounding analysis was generated for. */
  fallbackProject?: string;
}

function MarkdownRendererImpl({
  content,
  className = '',
  fallbackProject,
}: Readonly<MarkdownRendererProps>) {
  return (
    <div className={`markdown-renderer ${className}`}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        urlTransform={urlTransform}
        components={{
          h1: ({ node: _n, children, ...props }) => (
            <h1 className="text-2xl font-bold mb-4 mt-6 first:mt-0" {...props}>
              {children}
            </h1>
          ),
          h2: ({ node: _n, children, ...props }) => (
            <h2 className="text-xl font-semibold mb-3 mt-5" {...props}>
              {children}
            </h2>
          ),
          h3: ({ node: _n, children, ...props }) => (
            <h3 className="text-lg font-medium mb-2 mt-4" {...props}>
              {children}
            </h3>
          ),

          p: ({ node: _n, children, ...props }) => (
            <p className="mb-4 leading-relaxed" {...props}>
              {children}
            </p>
          ),

          ul: ({ node: _n, children, ...props }) => (
            <ul className="list-disc list-inside space-y-2 mb-4" {...props}>
              {children}
            </ul>
          ),
          ol: ({ node: _n, children, ...props }) => (
            <ol className="list-decimal list-inside space-y-2 mb-4" {...props}>
              {children}
            </ol>
          ),
          li: ({ node: _n, children, ...props }) => (
            <li className="leading-relaxed" {...props}>
              {children}
            </li>
          ),

          a: ({ node: _n, children, href, ...props }) => {
            if (href?.startsWith('pwrs:')) {
              const target = resolvePwrsHref(href, fallbackProject);
              if (target) {
                return (
                  <RouterLink
                    to={target}
                    className="text-primary hover:underline transition-colors"
                  >
                    {children}
                  </RouterLink>
                );
              }
              // Unknown pwrs: subscheme — render the label as plain muted
              // text so a stale or fabricated ref doesn't show a broken link.
              return <span className="text-muted-foreground">{children}</span>;
            }
            return (
              <a
                href={href}
                className="text-primary hover:underline transition-colors"
                target="_blank"
                rel="noopener noreferrer"
                {...props}
              >
                {children}
              </a>
            );
          },

          strong: ({ node: _n, children, ...props }) => (
            <strong className="font-semibold" {...props}>
              {children}
            </strong>
          ),
          em: ({ node: _n, children, ...props }) => (
            <em className="italic" {...props}>
              {children}
            </em>
          ),

          code: ({ node: _n, children, className, ...props }) => {
            const text = reactNodeToText(children);
            if (!className && text.trim().length === 0) return null;

            const isInline = !className;
            if (isInline) {
              return (
                <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                  {children}
                </code>
              );
            }

            // rehype-highlight prefixes `hljs ` to the className, so a plain
            // `replace('language-', '')` leaves `hljs ts`. Match the language
            // class anywhere in the list instead.
            const language = className?.match(/language-([\w+#-]+)/)?.[1] || 'text';

            return (
              <div className="relative group mb-4">
                <div className="flex items-center justify-between bg-muted px-4 py-2 rounded-t-lg border">
                  <Badge variant="secondary">{language}</Badge>
                  <CopyButton content={text.replace(/\n$/, '')} />
                </div>
                <pre className="bg-muted p-4 rounded-b-lg border border-t-0 overflow-x-auto">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            );
          },

          blockquote: ({ node: _n, children, ...props }) => (
            <blockquote
              className="border-l-4 border-primary bg-primary/10 pl-4 py-2 my-4 italic"
              {...props}
            >
              {children}
            </blockquote>
          ),

          table: ({ node: _n, children, ...props }) => (
            <div className="overflow-x-auto mb-4">
              <table className="min-w-full border-collapse border" {...props}>
                {children}
              </table>
            </div>
          ),
          thead: ({ node: _n, children, ...props }) => (
            <thead className="bg-muted" {...props}>
              {children}
            </thead>
          ),
          th: ({ node: _n, children, ...props }) => (
            <th className="border px-4 py-2 text-left font-semibold" {...props}>
              {children}
            </th>
          ),
          td: ({ node: _n, children, ...props }) => (
            <td className="border px-4 py-2" {...props}>
              {children}
            </td>
          ),

          hr: ({ node: _n, ...props }) => <hr className="my-6" {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownRenderer = memo(MarkdownRendererImpl);

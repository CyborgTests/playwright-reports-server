'use client';

import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { CopyButton } from './copy-button';
import { Badge } from './ui/badge';

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
}

export function MarkdownRenderer({ content, className = '' }: Readonly<MarkdownRendererProps>) {
  return (
    <div className={`markdown-renderer ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, rehypeRaw]}
        components={{
          h1: ({ children, ...props }) => (
            <h1 className="text-2xl font-bold mb-4 mt-6 first:mt-0" {...props}>
              {children}
            </h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 className="text-xl font-semibold mb-3 mt-5" {...props}>
              {children}
            </h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 className="text-lg font-medium mb-2 mt-4" {...props}>
              {children}
            </h3>
          ),

          p: ({ children, ...props }) => (
            <p className="mb-4 leading-relaxed" {...props}>
              {children}
            </p>
          ),

          ul: ({ children, ...props }) => (
            <ul className="list-disc list-inside space-y-2 mb-4" {...props}>
              {children}
            </ul>
          ),
          ol: ({ children, ...props }) => (
            <ol className="list-decimal list-inside space-y-2 mb-4" {...props}>
              {children}
            </ol>
          ),
          li: ({ children, ...props }) => (
            <li className="leading-relaxed" {...props}>
              {children}
            </li>
          ),

          a: ({ children, href, ...props }) => (
            <a
              href={href}
              className="text-primary hover:underline transition-colors"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            >
              {children}
            </a>
          ),

          strong: ({ children, ...props }) => (
            <strong className="font-semibold" {...props}>
              {children}
            </strong>
          ),
          em: ({ children, ...props }) => (
            <em className="italic" {...props}>
              {children}
            </em>
          ),

          code: ({ children, className, ...props }) => {
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
                  <CopyButton content={reactNodeToText(children).replace(/\n$/, '')} />
                </div>
                <pre className="bg-muted p-4 rounded-b-lg border border-t-0 overflow-x-auto">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            );
          },

          blockquote: ({ children, ...props }) => (
            <blockquote
              className="border-l-4 border-primary bg-primary/10 pl-4 py-2 my-4 italic"
              {...props}
            >
              {children}
            </blockquote>
          ),

          table: ({ children, ...props }) => (
            <div className="overflow-x-auto mb-4">
              <table className="min-w-full border-collapse border" {...props}>
                {children}
              </table>
            </div>
          ),
          thead: ({ children, ...props }) => (
            <thead className="bg-muted" {...props}>
              {children}
            </thead>
          ),
          th: ({ children, ...props }) => (
            <th className="border px-4 py-2 text-left font-semibold" {...props}>
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td className="border px-4 py-2" {...props}>
              {children}
            </td>
          ),

          hr: ({ ...props }) => <hr className="my-6" {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

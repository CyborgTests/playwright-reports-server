import type { SlackBlock } from '@playwright-reports/shared';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { useMemo } from 'react';
import { previewRender } from './templating';

interface SlackPreviewProps {
  blocks: SlackBlock[];
  variables: readonly string[];
  sample: Record<string, unknown>;
}

export function SlackPreview({ blocks, variables, sample }: Readonly<SlackPreviewProps>) {
  const allowlist = useMemo(() => new Set(variables), [variables]);

  if (blocks.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center">
        <p className="text-sm text-muted-foreground">Add blocks to see a preview.</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card overflow-hidden text-sm">
      <div className="px-3 py-2 border-b bg-muted/30 text-xs text-muted-foreground">
        Slack preview · using sample data
      </div>
      <div className="p-4 space-y-3">
        {blocks.map((block, idx) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: read-only preview
          <PreviewBlock key={idx} block={block} sample={sample} allowlist={allowlist} />
        ))}
      </div>
    </div>
  );
}

interface PreviewBlockProps {
  block: SlackBlock;
  sample: Record<string, unknown>;
  allowlist: ReadonlySet<string>;
}

function PreviewBlock({ block, sample, allowlist }: Readonly<PreviewBlockProps>) {
  const renderText = (input: string) => previewRender(input, sample, allowlist);

  if (block.type === 'divider') {
    return <hr className="border-t border-border" />;
  }

  if (block.type === 'header') {
    const r = renderText(block.text);
    return (
      <PreviewLine
        error={r.error}
        content={<h3 className="text-base font-bold leading-snug">{r.output}</h3>}
      />
    );
  }

  if (block.type === 'section') {
    const r = renderText(block.text);
    return (
      <PreviewLine
        error={r.error}
        content={<MrkdwnText className="text-foreground leading-relaxed" text={r.output} />}
      />
    );
  }

  if (block.type === 'context') {
    const r = renderText(block.text);
    return (
      <PreviewLine
        error={r.error}
        content={<MrkdwnText className="text-xs text-muted-foreground" text={r.output} />}
      />
    );
  }

  if (block.type === 'image') {
    const urlR = renderText(block.url);
    const altR = block.altText ? renderText(block.altText) : { output: '', error: undefined };
    const error = urlR.error ?? altR.error;
    return (
      <PreviewLine
        error={error}
        content={
          urlR.output ? (
            <div className="rounded border bg-muted/30 px-3 py-2">
              <div className="text-xs text-muted-foreground">Image</div>
              <div className="font-mono text-xs break-all">{urlR.output}</div>
              {altR.output && (
                <div className="text-xs text-muted-foreground mt-1">alt: {altR.output}</div>
              )}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground italic">No URL set</div>
          )
        }
      />
    );
  }

  const buttons = block.buttons.map((b) => ({
    label: renderText(b.label),
    url: renderText(b.url),
  }));
  const error = buttons.find((b) => b.label.error || b.url.error);

  return (
    <PreviewLine
      error={error?.label.error ?? error?.url.error}
      content={
        <div className="flex gap-2 flex-wrap">
          {buttons.map((btn, i) => (
            <button
              key={`${btn.url.output}::${i}`}
              type="button"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded border bg-background hover:bg-accent text-sm"
              title={btn.url.output}
              onClick={(e) => {
                // avoid navigation for preview
                e.preventDefault();
              }}
            >
              {btn.label.output}
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
            </button>
          ))}
        </div>
      }
    />
  );
}

function PreviewLine({ content, error }: Readonly<{ content: React.ReactNode; error?: string }>) {
  if (error) {
    return (
      <div className="rounded border border-danger/40 bg-danger-50 px-3 py-2 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-danger mt-0.5 shrink-0" />
        <div className="text-xs text-danger break-words">{error}</div>
      </div>
    );
  }
  return <div>{content}</div>;
}

function MrkdwnText({ text, className }: Readonly<{ text: string; className?: string }>) {
  const lines = text.split('\n');
  return (
    <div className={className}>
      {lines.map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable preview render
        <div key={i}>{line ? renderMrkdwnLine(line) : <>&nbsp;</>}</div>
      ))}
    </div>
  );
}

const TOKEN = /(\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|<[^>\n]+>)/g;

function renderMrkdwnLine(line: string): React.ReactNode {
  const parts = line.split(TOKEN).filter((p) => p !== '');
  return parts.map((part, i) => {
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      // biome-ignore lint/suspicious/noArrayIndexKey: stable preview render
      return <strong key={i}>{part.slice(1, -1)}</strong>;
    }
    if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
      // biome-ignore lint/suspicious/noArrayIndexKey: stable preview render
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable preview render
        <code key={i} className="px-1 py-0.5 rounded bg-muted font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('<') && part.endsWith('>')) {
      const inner = part.slice(1, -1);
      const pipeIdx = inner.indexOf('|');
      const url = pipeIdx === -1 ? inner : inner.slice(0, pipeIdx);
      const label = pipeIdx === -1 ? inner : inner.slice(pipeIdx + 1);
      return (
        <a
          // biome-ignore lint/suspicious/noArrayIndexKey: stable preview render
          key={i}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          {label}
        </a>
      );
    }
    // biome-ignore lint/suspicious/noArrayIndexKey: stable preview render
    return <span key={i}>{part}</span>;
  });
}

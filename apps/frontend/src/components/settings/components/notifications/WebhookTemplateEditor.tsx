import { jsonValueEscape } from '@playwright-reports/shared';
import { useMemo } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { previewRender } from './templating';

interface WebhookTemplateEditorProps {
  bodyJson: string;
  onChange: (next: string) => void;
}

export function WebhookTemplateEditor({
  bodyJson,
  onChange,
}: Readonly<WebhookTemplateEditorProps>) {
  return (
    <div className="space-y-2">
      <Textarea
        value={bodyJson}
        onChange={(e) => onChange(e.target.value)}
        rows={14}
        className="font-mono text-xs"
      />
      <p className="text-xs text-muted-foreground">
        JSON body. <code>{'{{var}}'}</code> substitutions are applied to string values.
      </p>
    </div>
  );
}

interface WebhookPreviewProps {
  bodyJson: string;
  variables: readonly string[];
  sample: Record<string, unknown>;
}

export function WebhookPreview({ bodyJson, variables, sample }: Readonly<WebhookPreviewProps>) {
  const allowlist = useMemo(() => new Set(variables), [variables]);
  const rendered = previewRender(bodyJson, sample, allowlist, jsonValueEscape);

  let pretty = rendered.output;
  let parseError: string | undefined;
  try {
    if (rendered.output) pretty = JSON.stringify(JSON.parse(rendered.output), null, 2);
  } catch (err) {
    parseError = err instanceof Error ? err.message : 'Invalid JSON';
  }

  return (
    <div className="rounded-md border bg-card overflow-hidden text-sm">
      <div className="px-3 py-2 border-b bg-muted/30 text-xs text-muted-foreground">
        Webhook preview · using sample data
      </div>
      <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-all">{pretty}</pre>
      {(rendered.error || parseError) && (
        <div className="px-3 py-2 border-t border-danger/40 bg-danger-50 text-xs text-danger">
          {rendered.error ?? `JSON: ${parseError}`}
        </div>
      )}
    </div>
  );
}

import type { LlmModel } from '@playwright-reports/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';

export function LLMModelRow({
  model: m,
  index,
  total,
  busy,
  onMoveUp,
  onMoveDown,
  onToggleEnabled,
  onTest,
  onSetPrimary,
  onDuplicate,
  onEdit,
  onDelete,
}: Readonly<{
  model: LlmModel;
  index: number;
  total: number;
  busy: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleEnabled: () => void;
  onTest: () => void;
  onSetPrimary: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}>) {
  return (
    <div className="border rounded-md p-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <div className="flex flex-col gap-0.5 pt-0.5">
          {index > 0 && (
            <button
              type="button"
              aria-label="Move up"
              className="text-muted-foreground hover:text-foreground"
              onClick={onMoveUp}
            >
              ▲
            </button>
          )}
          {index < total - 1 && (
            <button
              type="button"
              aria-label="Move down"
              className="text-muted-foreground hover:text-foreground"
              onClick={onMoveDown}
            >
              ▼
            </button>
          )}
        </div>
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{m.label}</span>
            {m.isPrimary && <Badge variant="success">Primary</Badge>}
            {m.lastError ? (
              <Badge variant="destructive" className="text-xs" title={m.lastError}>
                Failing
              </Badge>
            ) : m.lastTestedAt ? (
              <Badge variant="secondary" className="text-xs">
                Tested
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs">
                Never tested
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            <div>
              <span className="font-mono">{m.provider}</span> ·{' '}
              <span className="font-mono">{m.model}</span>
            </div>
            <div className="font-mono truncate">{m.baseUrl}</div>
            <div>
              {m.parallelRequests} parallel request{m.parallelRequests === 1 ? '' : 's'}
              {m.maxTokens ? <> · max {m.maxTokens} tok</> : null}
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0">
        <div
          className="flex items-center gap-1.5"
          title={m.lastTestedAt ? '' : 'Test the connection first'}
        >
          <Switch
            checked={m.enabled}
            disabled={!m.enabled && !m.lastTestedAt}
            onCheckedChange={onToggleEnabled}
          />
          <span className="text-xs text-muted-foreground">Enabled</span>
        </div>
        <Button size="sm" variant="outline" onClick={onTest} disabled={busy}>
          {busy && <Spinner className="mr-2 h-4 w-4" />}
          Test
        </Button>
        {!m.isPrimary && (
          <Button
            size="sm"
            variant="outline"
            onClick={onSetPrimary}
            disabled={busy || !m.enabled}
            title={m.enabled ? '' : 'Enable the model first'}
          >
            Set as primary
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onDuplicate} disabled={busy}>
          Duplicate
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={onDelete}
          disabled={m.isPrimary}
          title={m.isPrimary ? 'Make another model primary first' : ''}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

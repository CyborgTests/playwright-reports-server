import type { DiscoveredModel } from '@playwright-reports/shared';
import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import useMutation from '@/hooks/useMutation';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

type DiscoverResponse = { success: boolean; error?: string; models?: DiscoveredModel[] };

/**
 * Model id field with the provider's live model list. Typing filters by name or id;
 * picking writes the id. Any typed id is kept as is.
 */
export function ModelIdInput({
  id,
  value,
  onChange,
  discoverBody,
}: Readonly<{
  id: string;
  value: string;
  onChange: (id: string) => void;
  /** Body for POST /discover, or null while the URL/key are missing. */
  discoverBody: Record<string, unknown> | null;
}>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const loadedFor = useRef<string | null>(null);
  const discover = useMutation<DiscoverResponse, Record<string, unknown>>(
    '/api/config/llm-models/discover',
    { method: 'POST', silent: true }
  );
  const models = discover.data?.models ?? null;
  const error = discover.error
    ? errorMessage(discover.error)
    : discover.data && !discover.data.success
      ? (discover.data.error ?? 'Could not list models')
      : null;

  const load = () => {
    const key = discoverBody && JSON.stringify(discoverBody);
    if (!discoverBody || key === loadedFor.current) return;
    loadedFor.current = key;
    discover.mutate({ body: discoverBody });
  };

  const hint = () => {
    if (error) return error;
    if (models) return `${models.length} models from the provider. Type a name or id.`;
    if (discover.isPending) return 'Loading models…';
    if (discoverBody) return 'Pick from the provider list or type an id.';
    return 'Set the base URL and API key to list models.';
  };

  const q = value.trim().toLowerCase();
  const hits = (models ?? []).filter(
    (m) => !q || m.id.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q)
  );
  const pick = (m: DiscoveredModel) => {
    onChange(m.id);
    setOpen(false);
  };

  return (
    <Popover open={open && hits.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          id={id}
          value={value}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && hits.length > 0}
          aria-controls={`${id}-list`}
          placeholder="e.g. claude-opus-4-8"
          onFocus={() => {
            setOpen(true);
            load();
          }}
          onChange={(e) => {
            onChange(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setOpen(true);
              const step = e.key === 'ArrowDown' ? 1 : -1;
              setActive((i) => (i + step + hits.length) % Math.max(1, hits.length));
            } else if (e.key === 'Enter' && open && hits[active]) {
              e.preventDefault();
              pick(hits[active]);
            } else if (e.key === 'Escape' && open) {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
      </PopoverAnchor>
      <p className="text-xs text-muted-foreground">{hint()}</p>
      <PopoverContent
        id={`${id}-list`}
        role="listbox"
        className="w-[var(--radix-popover-trigger-width)] max-h-60 overflow-y-auto p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (e.target === document.getElementById(id)) e.preventDefault();
        }}
      >
        {hits.map((m, i) => (
          <div
            key={m.id}
            role="option"
            aria-selected={i === active}
            tabIndex={-1}
            className={cn(
              'flex cursor-pointer justify-between gap-3 rounded-sm px-2 py-1.5 text-sm',
              i === active && 'bg-accent'
            )}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(m)}
            onKeyDown={() => undefined}
          >
            <span className="truncate">{m.name || m.id}</span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{m.id}</span>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

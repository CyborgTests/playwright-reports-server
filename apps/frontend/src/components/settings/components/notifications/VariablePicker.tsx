import { Code2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface VariablePickerProps {
  variables: readonly string[];
  onPick: (name: string) => void;
}

export function VariablePicker({ variables, onPick }: Readonly<VariablePickerProps>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const filtered = query
    ? variables.filter((v) => v.toLowerCase().includes(query.toLowerCase()))
    : variables;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          title="Insert variable"
        >
          <Code2 className="h-3.5 w-3.5 mr-1" />
          {'{{'} var {'}}'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <div className="p-2 border-b">
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter variables…"
            className="w-full text-sm bg-transparent border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-3 py-2">No matches.</p>
          ) : (
            filtered.map((name) => (
              <button
                type="button"
                key={name}
                onClick={() => {
                  onPick(name);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent font-mono"
              >
                {'{{'}
                {name}
                {'}}'}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function insertVariable(
  current: string,
  name: string,
  selectionStart: number | null,
  selectionEnd: number | null
): { next: string; cursor: number } {
  const insert = `{{${name}}}`;
  const start = selectionStart ?? current.length;
  const end = selectionEnd ?? current.length;
  const next = current.slice(0, start) + insert + current.slice(end);
  return { next, cursor: start + insert.length };
}

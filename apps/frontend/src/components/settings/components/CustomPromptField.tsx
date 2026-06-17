import type { PromptVariable } from '@playwright-reports/shared';
import { useRef, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface CustomPromptFieldProps {
  id: string;
  label: string;
  rows: number;
  disabled: boolean;
  defaultPrompt: string | undefined;
  override: string | undefined;
  helper: React.ReactNode;
  variables: readonly PromptVariable[];
  onChange: (next: string | undefined) => void;
}

export function CustomPromptField({
  id,
  label,
  rows,
  disabled,
  defaultPrompt,
  override,
  helper,
  variables,
  onChange,
}: CustomPromptFieldProps) {
  const resolved = override ?? defaultPrompt ?? '';
  // Override is "active" only when it differs from the default. Editing back to
  // the default is treated as a reset so future default updates flow through.
  const isCustom = override !== undefined && override !== '' && override !== defaultPrompt;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Autocomplete state for {{var}} suggestions. Opens when the cursor sits
  // inside an unclosed `{{…` token, narrows by what's typed after the braces,
  // and closes on `}}`, newline, or Escape.
  const [acOpen, setAcOpen] = useState(false);
  const [acFilter, setAcFilter] = useState('');
  const [acIndex, setAcIndex] = useState(0);
  const filtered = variables.filter((v) => v.name.toLowerCase().includes(acFilter.toLowerCase()));

  const recomputeAutocomplete = (text: string, cursor: number) => {
    if (variables.length === 0) {
      setAcOpen(false);
      return;
    }
    const before = text.slice(0, cursor);
    const lastOpen = before.lastIndexOf('{{');
    if (lastOpen === -1) {
      setAcOpen(false);
      return;
    }
    const between = before.slice(lastOpen + 2);
    if (between.includes('}}') || between.includes('\n')) {
      setAcOpen(false);
      return;
    }
    setAcFilter(between);
    setAcIndex(0);
    setAcOpen(true);
  };

  const insertVariable = (name: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart;
    const before = resolved.slice(0, cursor);
    const lastOpen = before.lastIndexOf('{{');
    if (lastOpen === -1) return;
    const after = resolved.slice(cursor);
    const token = `{{${name}}}`;
    const next = resolved.slice(0, lastOpen) + token + after;
    onChange(next === defaultPrompt || next === '' ? undefined : next);
    setAcOpen(false);
    // Defer focus restoration until after the controlled value updates.
    queueMicrotask(() => {
      const node = textareaRef.current;
      if (!node) return;
      const newCursor = lastOpen + token.length;
      node.focus();
      node.setSelectionRange(newCursor, newCursor);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {!disabled && isCustom && (
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => onChange(undefined)}
          >
            Reset to default
          </button>
        )}
      </div>
      <div className="relative">
        <Textarea
          ref={textareaRef}
          id={id}
          disabled={disabled}
          rows={rows}
          value={resolved}
          onChange={(e) => {
            const next = e.target.value;
            onChange(next === defaultPrompt || next === '' ? undefined : next);
            recomputeAutocomplete(next, e.target.selectionStart);
          }}
          onKeyDown={(e) => {
            if (!acOpen || filtered.length === 0) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setAcIndex((i) => (i + 1) % filtered.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setAcIndex((i) => (i - 1 + filtered.length) % filtered.length);
            } else if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              insertVariable(filtered[acIndex].name);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setAcOpen(false);
            }
          }}
          onBlur={() => setAcOpen(false)}
        />
        {acOpen && filtered.length > 0 && (
          <div className="absolute left-0 right-0 mt-1 z-20 border bg-popover rounded-md shadow-md max-h-48 overflow-auto">
            {filtered.map((v, i) => (
              <button
                key={v.name}
                type="button"
                className={`w-full text-left px-2 py-1.5 text-sm flex items-center gap-2 hover:bg-accent ${
                  i === acIndex ? 'bg-accent' : ''
                }`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertVariable(v.name);
                }}
              >
                <span className="font-mono text-xs">{`{{${v.name}}}`}</span>
                <span className="text-xs text-muted-foreground truncate">{v.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{helper}</p>
    </div>
  );
}

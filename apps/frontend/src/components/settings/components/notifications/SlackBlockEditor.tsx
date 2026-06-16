import type { SlackBlock } from '@playwright-reports/shared';
import {
  ArrowDown,
  ArrowUp,
  Heading,
  Image as ImageIcon,
  Minus,
  MousePointerClick,
  Plus,
  Text,
  Trash2,
  Type,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { urlVariablesOnly } from './templating';
import { insertVariable, VariablePicker } from './VariablePicker';

interface SlackBlockEditorProps {
  blocks: SlackBlock[];
  onChange: (blocks: SlackBlock[]) => void;
  variables: readonly string[];
}

const BLOCK_TYPE_LABEL: Record<SlackBlock['type'], string> = {
  header: 'Header',
  section: 'Section',
  divider: 'Divider',
  context: 'Context',
  actions: 'Buttons',
  image: 'Image',
};

const BLOCK_ICONS: Record<SlackBlock['type'], typeof Heading> = {
  header: Heading,
  section: Type,
  divider: Minus,
  context: Text,
  actions: MousePointerClick,
  image: ImageIcon,
};

function newBlock(type: SlackBlock['type']): SlackBlock {
  switch (type) {
    case 'header':
      return { type: 'header', text: 'New header' };
    case 'section':
      return { type: 'section', text: 'New section body' };
    case 'divider':
      return { type: 'divider' };
    case 'context':
      return { type: 'context', text: 'Small muted line' };
    case 'actions':
      return { type: 'actions', buttons: [{ label: 'View', url: '{{reportUrl}}' }] };
    case 'image':
      return { type: 'image', url: '', altText: '' };
  }
}

export function SlackBlockEditor({ blocks, onChange, variables }: Readonly<SlackBlockEditorProps>) {
  const [ids, setIds] = useState<string[]>(() =>
    Array.from({ length: blocks.length }, () => crypto.randomUUID())
  );
  useEffect(() => {
    setIds((prev) => {
      if (prev.length === blocks.length) return prev;
      if (prev.length < blocks.length) {
        const grown = prev.slice();
        while (grown.length < blocks.length) grown.push(crypto.randomUUID());
        return grown;
      }
      return prev.slice(0, blocks.length);
    });
  }, [blocks.length]);

  const move = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= blocks.length) return;
    const nextBlocks = blocks.slice();
    const nextIds = ids.slice();
    [nextBlocks[idx], nextBlocks[target]] = [nextBlocks[target], nextBlocks[idx]];
    [nextIds[idx], nextIds[target]] = [nextIds[target], nextIds[idx]];
    setIds(nextIds);
    onChange(nextBlocks);
  };
  const remove = (idx: number) => {
    setIds(ids.filter((_, i) => i !== idx));
    onChange(blocks.filter((_, i) => i !== idx));
  };
  const updateBlock = (idx: number, patch: SlackBlock) => {
    onChange(blocks.map((b, i) => (i === idx ? patch : b)));
  };
  const add = (type: SlackBlock['type']) => {
    setIds([...ids, crypto.randomUUID()]);
    onChange([...blocks, newBlock(type)]);
  };

  return (
    <div className="space-y-2">
      {blocks.length === 0 ? (
        <p className="text-sm text-muted-foreground italic px-2 py-4 text-center border border-dashed rounded-md">
          No blocks. Add one below.
        </p>
      ) : (
        blocks.map((block, idx) => {
          const Icon = BLOCK_ICONS[block.type];
          return (
            <div key={ids[idx] ?? `pending-${idx}`} className="rounded-md border bg-card">
              <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium">{BLOCK_TYPE_LABEL[block.type]}</span>
                <span className="text-xs text-muted-foreground">block {idx + 1}</span>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    aria-label="Move up"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => move(idx, 1)}
                    disabled={idx === blocks.length - 1}
                    aria-label="Move down"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(idx)}
                    aria-label="Remove block"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="p-3">
                <BlockForm
                  block={block}
                  variables={variables}
                  onChange={(next) => updateBlock(idx, next)}
                />
              </div>
            </div>
          );
        })
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Add block
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {(['header', 'section', 'divider', 'context', 'actions', 'image'] as const).map((t) => (
            <DropdownMenuItem key={t} onClick={() => add(t)}>
              {BLOCK_TYPE_LABEL[t]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

interface BlockFormProps {
  block: SlackBlock;
  variables: readonly string[];
  onChange: (next: SlackBlock) => void;
}

function BlockForm({ block, variables, onChange }: Readonly<BlockFormProps>) {
  if (block.type === 'divider') {
    return <p className="text-xs text-muted-foreground italic">Visual separator. No options.</p>;
  }

  if (block.type === 'header') {
    return (
      <MustacheTextField
        label="Text"
        value={block.text}
        onChange={(v) => onChange({ ...block, text: v })}
        variables={variables}
        maxLength={150}
        helper="Max 150 characters. Plain text — no formatting."
      />
    );
  }

  if (block.type === 'section') {
    return (
      <MustacheTextField
        label="Body"
        value={block.text}
        onChange={(v) => onChange({ ...block, text: v })}
        variables={variables}
        multiline
        rows={4}
        maxLength={3000}
        helper={
          <>
            Slack mrkdwn: <code>*bold*</code> <code>_italic_</code> <code>`code`</code>{' '}
            <code>&lt;url|label&gt;</code>
          </>
        }
      />
    );
  }

  if (block.type === 'context') {
    return (
      <MustacheTextField
        label="Text"
        value={block.text}
        onChange={(v) => onChange({ ...block, text: v })}
        variables={variables}
        multiline
        rows={2}
        maxLength={3000}
        helper="Small muted line — usually a timestamp or report number."
      />
    );
  }

  if (block.type === 'image') {
    return (
      <div className="space-y-3">
        <MustacheTextField
          label="Image URL"
          value={block.url}
          onChange={(v) => onChange({ ...block, url: v })}
          variables={urlVariablesOnly(variables)}
          maxLength={3000}
          helper="Must be a publicly fetchable URL — Slack downloads it from your image host."
        />
        <MustacheTextField
          label="Alt text (optional)"
          value={block.altText ?? ''}
          onChange={(v) => onChange({ ...block, altText: v || undefined })}
          variables={variables}
          maxLength={2000}
        />
      </div>
    );
  }

  return <ActionsBlockForm block={block} variables={variables} onChange={onChange} />;
}

interface ActionsBlockFormProps {
  block: Extract<SlackBlock, { type: 'actions' }>;
  variables: readonly string[];
  onChange: (next: SlackBlock) => void;
}

function ActionsBlockForm({ block, variables, onChange }: Readonly<ActionsBlockFormProps>) {
  const [btnIds, setBtnIds] = useState<string[]>(() =>
    Array.from({ length: block.buttons.length }, () => crypto.randomUUID())
  );
  useEffect(() => {
    setBtnIds((prev) => {
      if (prev.length === block.buttons.length) return prev;
      if (prev.length < block.buttons.length) {
        const grown = prev.slice();
        while (grown.length < block.buttons.length) grown.push(crypto.randomUUID());
        return grown;
      }
      return prev.slice(0, block.buttons.length);
    });
  }, [block.buttons.length]);

  const updateButton = (idx: number, patch: Partial<{ label: string; url: string }>) => {
    onChange({
      ...block,
      buttons: block.buttons.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    });
  };
  const removeButton = (idx: number) => {
    setBtnIds(btnIds.filter((_, i) => i !== idx));
    onChange({ ...block, buttons: block.buttons.filter((_, i) => i !== idx) });
  };
  const addButton = () => {
    if (block.buttons.length >= 5) return;
    setBtnIds([...btnIds, crypto.randomUUID()]);
    onChange({ ...block, buttons: [...block.buttons, { label: 'View', url: '{{reportUrl}}' }] });
  };

  return (
    <div className="space-y-3">
      {block.buttons.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No buttons. Add one below.</p>
      ) : (
        block.buttons.map((btn, idx) => (
          <div
            key={btnIds[idx] ?? `pending-${idx}`}
            className="grid gap-2 grid-cols-[1fr_2fr_auto] items-end"
          >
            <MustacheTextField
              label={idx === 0 ? 'Label' : undefined}
              value={btn.label}
              onChange={(v) => updateButton(idx, { label: v })}
              variables={variables}
              maxLength={75}
              compact
            />
            <MustacheTextField
              label={idx === 0 ? 'URL' : undefined}
              value={btn.url}
              onChange={(v) => updateButton(idx, { url: v })}
              variables={urlVariablesOnly(variables)}
              maxLength={3000}
              compact
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeButton(idx)}
              aria-label="Remove button"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addButton}
        disabled={block.buttons.length >= 5}
      >
        <Plus className="h-4 w-4 mr-1" />
        Add button
        {block.buttons.length >= 5 && (
          <span className="text-xs text-muted-foreground ml-2">(max 5)</span>
        )}
      </Button>
    </div>
  );
}

interface MustacheTextFieldProps {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  variables: readonly string[];
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  helper?: React.ReactNode;
  compact?: boolean;
}

function detectVariableTyping(
  value: string,
  caret: number
): { active: boolean; partial: string; tagStart: number } {
  for (let i = caret - 1; i >= 1; i--) {
    const ch = value[i];
    if (ch === '}') return { active: false, partial: '', tagStart: -1 };
    if (ch === '{' && value[i - 1] === '{') {
      const partial = value.slice(i + 1, caret);
      if (partial.includes('}') || partial.includes('{')) {
        return { active: false, partial: '', tagStart: -1 };
      }
      return { active: true, partial, tagStart: i - 1 };
    }
  }
  return { active: false, partial: '', tagStart: -1 };
}

function MustacheTextField({
  label,
  value,
  onChange,
  variables,
  multiline,
  rows,
  maxLength,
  helper,
  compact,
}: Readonly<MustacheTextFieldProps>) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const [autocomplete, setAutocomplete] = useState<{
    active: boolean;
    partial: string;
    tagStart: number;
    highlighted: number;
  }>({ active: false, partial: '', tagStart: -1, highlighted: 0 });

  const matches = useMemo(() => {
    if (!autocomplete.active) return [] as readonly string[];
    const q = autocomplete.partial.toLowerCase();
    return variables.filter((v) => v.toLowerCase().includes(q)).slice(0, 8);
  }, [autocomplete.active, autocomplete.partial, variables]);

  useEffect(() => {
    setAutocomplete((prev) =>
      prev.highlighted >= matches.length ? { ...prev, highlighted: 0 } : prev
    );
  }, [matches.length]);

  const captureSelection = () => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    selectionRef.current = { start, end };
    if (start !== end) {
      setAutocomplete((prev) => (prev.active ? { ...prev, active: false } : prev));
      return;
    }
    const probe = detectVariableTyping(value, start);
    setAutocomplete((prev) =>
      probe.active
        ? { ...probe, highlighted: prev.active ? prev.highlighted : 0 }
        : prev.active
          ? { ...prev, active: false }
          : prev
    );
  };

  const closeAutocomplete = () =>
    setAutocomplete((prev) => (prev.active ? { ...prev, active: false } : prev));

  const acceptMatch = (name: string) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    if (!autocomplete.active) return;
    const before = value.slice(0, autocomplete.tagStart);
    const after = value.slice(caret);
    const insert = `{{${name}}}`;
    const next = before + insert + after;
    const nextCaret = autocomplete.tagStart + insert.length;
    onChange(next);
    setAutocomplete({ active: false, partial: '', tagStart: -1, highlighted: 0 });
    setTimeout(() => {
      const node = ref.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(nextCaret, nextCaret);
      selectionRef.current = { start: nextCaret, end: nextCaret };
    }, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!autocomplete.active || matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAutocomplete((prev) => ({
        ...prev,
        highlighted: (prev.highlighted + 1) % matches.length,
      }));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAutocomplete((prev) => ({
        ...prev,
        highlighted: (prev.highlighted - 1 + matches.length) % matches.length,
      }));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      acceptMatch(matches[autocomplete.highlighted]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeAutocomplete();
    }
  };

  const handleInsert = (name: string) => {
    const start = selectionRef.current?.start ?? value.length;
    const end = selectionRef.current?.end ?? value.length;
    const { next, cursor } = insertVariable(value, name, start, end);
    onChange(next);
    setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
      selectionRef.current = { start: cursor, end: cursor };
    }, 0);
  };

  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      {(label || !compact) && (
        <div className="flex items-center justify-between gap-2 min-h-[1.5rem]">
          {label ? <Label className="text-xs">{label}</Label> : <span />}
          <VariablePicker variables={variables} onPick={handleInsert} />
        </div>
      )}
      <div className="relative">
        {multiline ? (
          <Textarea
            ref={ref as React.RefObject<HTMLTextAreaElement>}
            value={value}
            rows={rows ?? 3}
            maxLength={maxLength}
            onChange={(e) => onChange(e.target.value)}
            onFocus={captureSelection}
            onSelect={captureSelection}
            onKeyUp={captureSelection}
            onKeyDown={onKeyDown}
            onClick={captureSelection}
            onBlur={() => setTimeout(closeAutocomplete, 100)}
            className="font-mono text-sm"
          />
        ) : (
          <Input
            ref={ref as React.RefObject<HTMLInputElement>}
            value={value}
            maxLength={maxLength}
            onChange={(e) => onChange(e.target.value)}
            onFocus={captureSelection}
            onSelect={captureSelection}
            onKeyUp={captureSelection}
            onKeyDown={onKeyDown}
            onClick={captureSelection}
            onBlur={() => setTimeout(closeAutocomplete, 100)}
            className="font-mono text-sm"
          />
        )}
        {autocomplete.active && matches.length > 0 && (
          <div className="absolute z-50 left-0 right-0 top-full mt-1 rounded-md border bg-popover text-popover-foreground shadow-md max-h-56 overflow-y-auto">
            {matches.map((name, i) => (
              <button
                key={name}
                type="button"
                // mousedown (not click) so the input doesn't blur-close the
                // popover before we get the event.
                onMouseDown={(e) => {
                  e.preventDefault();
                  acceptMatch(name);
                }}
                className={`w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-accent ${
                  i === autocomplete.highlighted ? 'bg-accent' : ''
                }`}
              >
                {'{{'}
                {name}
                {'}}'}
              </button>
            ))}
            <div className="px-3 py-1 text-[10px] text-muted-foreground border-t bg-muted/30">
              ↑↓ to navigate · Enter/Tab to accept · Esc to dismiss
            </div>
          </div>
        )}
      </div>
      {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
    </div>
  );
}

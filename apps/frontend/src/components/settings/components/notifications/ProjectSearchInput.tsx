import { Check, ChevronsUpDown, Globe, Regex, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import useQuery from '@/hooks/useQuery';
import { withBase } from '@/lib/url';

interface ProjectSearchInputProps {
  value: string;
  mode: 'all' | 'project';
  onPickProject: (name: string) => void;
  onPickAll: () => void;
  onPickRegex: () => void;
}

export function ProjectSearchInput({
  value,
  mode,
  onPickProject,
  onPickAll,
  onPickRegex,
}: Readonly<ProjectSearchInputProps>) {
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery<string[]>(withBase('/api/report/projects'), {
    enabled: hasOpened,
  });

  const projects = useMemo(() => {
    const raw = Array.isArray(data) ? data : [];
    const trimmed = search.trim().toLowerCase();
    if (!trimmed) return raw;
    return raw.filter((p) => p.toLowerCase().includes(trimmed));
  }, [data, search]);

  const triggerLabel = mode === 'all' ? 'All projects' : value || 'Pick a project…';

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && !hasOpened) setHasOpened(true);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full min-w-0 justify-between font-normal"
        >
          <span
            className={`min-w-0 flex-1 truncate text-left ${value || mode === 'all' ? '' : 'text-muted-foreground'}`}
          >
            {triggerLabel}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search or type project name…"
              className="pl-7 h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && search.trim()) {
                  e.preventDefault();
                  onPickProject(search.trim());
                  setOpen(false);
                  setSearch('');
                }
              }}
            />
          </div>
        </div>
        <div className="max-h-[280px] overflow-y-auto">
          {!search.trim() && (
            <>
              <PickerItem
                icon={<Globe className="h-3.5 w-3.5 opacity-70" />}
                label="All projects"
                checked={mode === 'all'}
                onClick={() => {
                  onPickAll();
                  setOpen(false);
                }}
              />
              <PickerItem
                icon={<Regex className="h-3.5 w-3.5 opacity-70" />}
                label="Regex match…"
                checked={false}
                onClick={() => {
                  onPickRegex();
                  setOpen(false);
                  setSearch('');
                }}
              />
              <div className="border-t" />
            </>
          )}

          {isLoading && (
            <div className="px-3 py-2 text-xs text-muted-foreground italic">Loading…</div>
          )}
          {!isLoading && projects.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground text-center">
              {search.trim()
                ? `Press Enter to use "${search.trim()}"`
                : 'No projects in the report database yet.'}
            </div>
          )}
          {projects.map((p) => (
            <PickerItem
              key={p}
              label={p}
              checked={mode === 'project' && p === value}
              onClick={() => {
                onPickProject(p);
                setOpen(false);
                setSearch('');
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PickerItem({
  icon,
  label,
  checked,
  onClick,
}: Readonly<{
  icon?: React.ReactNode;
  label: string;
  checked: boolean;
  onClick: () => void;
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/50 flex items-center gap-2"
    >
      <Check className={`h-3.5 w-3.5 shrink-0 ${checked ? 'opacity-100' : 'opacity-0'}`} />
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

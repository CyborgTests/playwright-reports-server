import type { ReadReportsHistory, ReportHistory } from '@playwright-reports/shared';
import { ChevronsUpDown, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import useQuery from '@/hooks/useQuery';

interface ReportSearchInputProps {
  value: string;
  onChange: (reportId: string) => void;
  placeholder?: string;
}

export function ReportSearchInput({
  value,
  onChange,
  placeholder = 'Select a report…',
}: Readonly<ReportSearchInputProps>) {
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery<ReadReportsHistory>('/api/report/list?limit=100&offset=0', {
    enabled: hasOpened,
  });

  const reports = data?.reports ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) =>
      [
        r.title ?? '',
        r.project,
        r.reportID,
        r.displayNumber ? `#${r.displayNumber}` : '',
        r.displayNumber ? String(r.displayNumber) : '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [reports, search]);

  const selected = reports.find((r) => r.reportID === value);

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
            className={`min-w-0 flex-1 truncate text-left ${value ? '' : 'text-muted-foreground'}`}
          >
            {selected ? formatSummary(selected) : value || placeholder}
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
              placeholder="Search by title, project, or #…"
              className="pl-7 h-8 text-sm"
            />
          </div>
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {isLoading && (
            <div className="px-3 py-2 text-xs text-muted-foreground italic">Loading…</div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground text-center">
              {search.trim() ? 'No matches.' : 'No reports available.'}
            </div>
          )}
          {filtered.map((r) => (
            <button
              key={r.reportID}
              type="button"
              className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 border-b last:border-b-0 ${
                r.reportID === value ? 'bg-muted/30' : ''
              }`}
              onClick={() => {
                onChange(r.reportID);
                setOpen(false);
                setSearch('');
              }}
            >
              <div className="font-medium truncate">
                {r.displayNumber ? `#${r.displayNumber} ` : ''}
                {r.title || r.reportID.slice(0, 8)}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {r.project}
                {r.stats && (
                  <>
                    {' · '}
                    {r.stats.expected ?? 0}✓
                    {(r.stats.unexpected ?? 0) > 0 && (
                      <span className="text-danger ml-0.5">/ {r.stats.unexpected}✗</span>
                    )}
                    {(r.stats.flaky ?? 0) > 0 && (
                      <span className="text-warning ml-0.5">/ {r.stats.flaky}~</span>
                    )}
                  </>
                )}
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatSummary(r: ReportHistory): string {
  const head = r.displayNumber ? `#${r.displayNumber} ` : '';
  const title = r.title || r.reportID.slice(0, 8);
  const stats = r.stats;
  const passed = stats?.expected ?? 0;
  const failed = stats?.unexpected ?? 0;
  const flaky = stats?.flaky ?? 0;
  return `${head}${title} — ${r.project} (${passed}✓ / ${failed}✗ / ${flaky}~)`;
}

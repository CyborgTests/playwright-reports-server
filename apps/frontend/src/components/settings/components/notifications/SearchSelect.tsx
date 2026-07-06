import { ChevronsUpDown, Search } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import useQuery from '@/hooks/useQuery';

interface SearchSelectProps<TItem> {
  fetchUrl: string;
  toItems: (data: unknown) => TItem[];
  searchText: (item: TItem) => string;
  renderItem: (item: TItem, close: () => void) => ReactNode;
  triggerLabel: (items: TItem[]) => ReactNode;
  triggerMuted: boolean;
  searchPlaceholder: string;
  emptyText: (search: string) => string;
  quickActions?: (close: () => void) => ReactNode;
  onSubmitFreeText?: (text: string, close: () => void) => void;
  maxHeightClass?: string;
}

export function SearchSelect<TItem>({
  fetchUrl,
  toItems,
  searchText,
  renderItem,
  triggerLabel,
  triggerMuted,
  searchPlaceholder,
  emptyText,
  quickActions,
  onSubmitFreeText,
  maxHeightClass = 'max-h-[300px]',
}: Readonly<SearchSelectProps<TItem>>) {
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery<unknown>(fetchUrl, { enabled: hasOpened });

  const allItems = useMemo(() => toItems(data), [data, toItems]);
  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? allItems.filter((i) => searchText(i).toLowerCase().includes(q)) : allItems;
  }, [allItems, search, searchText]);

  const close = () => {
    setOpen(false);
    setSearch('');
  };

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
            className={`min-w-0 flex-1 truncate text-left ${triggerMuted ? 'text-muted-foreground' : ''}`}
          >
            {triggerLabel(allItems)}
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
              placeholder={searchPlaceholder}
              className="pl-7 h-8 text-sm"
              onKeyDown={
                onSubmitFreeText
                  ? (e) => {
                      if (e.key === 'Enter' && search.trim()) {
                        e.preventDefault();
                        onSubmitFreeText(search.trim(), close);
                      }
                    }
                  : undefined
              }
            />
          </div>
        </div>
        <div className={`${maxHeightClass} overflow-y-auto`}>
          {quickActions && !search.trim() && quickActions(close)}
          {isLoading && (
            <div className="px-3 py-2 text-xs text-muted-foreground italic">Loading…</div>
          )}
          {!isLoading && items.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground text-center">
              {emptyText(search.trim())}
            </div>
          )}
          {items.map((item) => renderItem(item, close))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

import { API_ENDPOINTS, type ReportHistory } from '@playwright-reports/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { GitCompare, Search } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import FormattedDate from '@/components/date-format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/hooks/useAuth';
import { withBase } from '@/lib/url';
import { withQueryParams } from '../../config/network';

interface Props {
  // ids that should be hidden from the picker's results — typically
  excludeReportIds: string[];
  defaultProject?: string;
  buildHref: (otherReportId: string) => string;
  triggerLabel?: ReactNode;
  openInNewTab?: boolean;
  triggerClassName?: string;
}

const PAGE_SIZE = 20;

interface ListResponse {
  reports: ReportHistory[];
  total: number;
}

export function CompareToPicker({
  excludeReportIds,
  defaultProject,
  buildHref,
  triggerLabel,
  openInNewTab = true,
  triggerClassName,
}: Props) {
  const session = useAuth();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  // Default to the same project so the comparison is meaningful;
  // user can opt out to search across all projects.
  const [scopeToProject, setScopeToProject] = useState(true);

  const isAuthDisabled = session.status === 'authenticated' && session.data === null;
  const isAuthReady = isAuthDisabled || session.status === 'authenticated';

  const queryKey = useMemo(
    () => ['compare-to-picker', scopeToProject ? defaultProject : '__all__'],
    [scopeToProject, defaultProject]
  );

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery<ListResponse>({
      queryKey,
      enabled: open && isAuthReady,
      initialPageParam: 0,
      queryFn: async ({ pageParam }) => {
        const headers: HeadersInit = {};
        const jwtToken = typeof window !== 'undefined' ? localStorage.getItem('jwtToken') : null;
        if (jwtToken && session.status === 'authenticated' && session.data !== null) {
          headers.Authorization = `Bearer ${jwtToken}`;
        }
        const params = {
          limit: PAGE_SIZE.toString(),
          offset: String(pageParam ?? 0),
          ...(scopeToProject && defaultProject ? { project: defaultProject } : {}),
        };
        const url = withBase(withQueryParams(API_ENDPOINTS.REPORTS_LIST, params));
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error('Failed to load reports');
        return res.json();
      },
      getNextPageParam: (lastPage, allPages) => {
        const loaded = allPages.reduce((sum, p) => sum + p.reports.length, 0);
        return loaded < lastPage.total ? loaded : undefined;
      },
    });

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const excludeSet = useMemo(() => new Set(excludeReportIds), [excludeReportIds]);
  const totalAvailable = data?.pages?.[0]?.total ?? 0;
  const allLoaded = useMemo(
    () =>
      (data?.pages ?? []).flatMap((p) => p.reports).filter((r) => !excludeSet.has(r.reportID)),
    [data, excludeSet]
  );

  const trimmedSearch = search.trim().toLowerCase();
  const reports = useMemo(() => {
    if (!trimmedSearch) return allLoaded;
    return allLoaded.filter((r) => {
      const haystack = [
        r.title ?? '',
        r.project,
        r.reportID,
        r.displayNumber ? `#${r.displayNumber}` : '',
        r.displayNumber ? String(r.displayNumber) : '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(trimmedSearch);
    });
  }, [allLoaded, trimmedSearch]);

  const hasEnoughMatches = reports.length >= 10;
  useEffect(() => {
    if (!open) return;
    if (!trimmedSearch) return;
    if (!hasNextPage || isFetchingNextPage) return;
    if (hasEnoughMatches) return;
    fetchNextPage();
  }, [open, trimmedSearch, hasNextPage, isFetchingNextPage, hasEnoughMatches, fetchNextPage]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={`gap-2 ${triggerClassName ?? ''}`.trim()}>
          <GitCompare className="h-4 w-4" />
          {triggerLabel ?? 'Compare to…'}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[420px] max-w-[90vw] p-0"
        align="start"
        side="bottom"
        avoidCollisions={false}
      >
        <div className="p-3 border-b space-y-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reports…"
              className="pl-7 h-8 text-sm"
              autoFocus
            />
          </div>
          {defaultProject && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={scopeToProject}
                onChange={(e) => setScopeToProject(e.target.checked)}
                className="h-3 w-3"
              />
              Same project only ({defaultProject})
            </label>
          )}
        </div>

        <div className="max-h-[360px] overflow-y-auto">
          {isLoading && (
            <div className="flex justify-center py-6">
              <Spinner size="sm" />
            </div>
          )}
          {!isLoading && reports.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              {trimmedSearch
                ? hasNextPage
                  ? 'No matches in loaded reports — keep typing or scroll to load more.'
                  : 'No matches.'
                : 'No reports to compare with.'}
            </div>
          )}
          {reports.map((report) => (
            <a
              key={report.reportID}
              href={buildHref(report.reportID)}
              {...(openInNewTab ? { target: '_blank', rel: 'noreferrer' } : {})}
              className="block px-3 py-2 border-b last:border-b-0 hover:bg-muted/50 transition-colors text-sm"
              onClick={() => setOpen(false)}
            >
              <div className="font-medium truncate">
                {report.displayNumber ? `#${report.displayNumber} ` : ''}
                {report.title ?? report.reportID.slice(0, 8)}
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                <span>{report.project}</span>
                <span>·</span>
                <FormattedDate date={report.createdAt} />
                {report.stats && (
                  <>
                    <span>·</span>
                    <span>
                      {report.stats.total} tests
                      {(report.stats.unexpected ?? 0) > 0 && (
                        <span className="text-failure ml-1">
                          ({report.stats.unexpected} failed)
                        </span>
                      )}
                    </span>
                  </>
                )}
              </div>
            </a>
          ))}
          <div ref={sentinelRef} className="h-4" />
          {isFetchingNextPage && (
            <div className="flex justify-center py-3">
              <Spinner size="sm" />
            </div>
          )}
          {!isLoading && !hasNextPage && allLoaded.length > 0 && (
            <div className="px-3 py-2 text-center text-[10px] text-muted-foreground">
              All {allLoaded.length} loaded
            </div>
          )}
          {!isLoading && hasNextPage && allLoaded.length > 0 && (
            <div className="px-3 py-2 text-center text-[10px] text-muted-foreground">
              Showing {reports.length} of {allLoaded.length} loaded · {totalAvailable} total
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

import type { DateRange, ReadResultsOutput, Result } from '@playwright-reports/shared';
import { keepPreviousData } from '@tanstack/react-query';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import useQuery from '@/hooks/useQuery';
import { defaultProjectName } from '@/lib/constants';
import { withQueryParams } from '@/lib/network';
import { withBase } from '@/lib/url';
import FormattedDate from './date-format';
import DeleteResultsButton from './delete-results-button';
import PaginatedControls from './paginated-controls';
import TablePaginationOptions from './table-pagination-options';

type UsageFilter = 'all' | 'used' | 'unused';

const usageOptions: Array<{ value: UsageFilter; label: string }> = [
  { value: 'all', label: 'All results' },
  { value: 'used', label: 'Used in reports' },
  { value: 'unused', label: 'Unused (no report)' },
];

const columns = [
  { name: 'Title', uid: 'title' },
  { name: 'Project', uid: 'project' },
  { name: 'Created at', uid: 'createdAt' },
  { name: 'Used in', uid: 'usedIn' },
  { name: 'Tags', uid: 'tags' },
  { name: 'Size', uid: 'size' },
  { name: '', uid: 'actions' },
];

const notMetadataKeys = new Set([
  'resultID',
  'title',
  'createdAt',
  'size',
  'sizeBytes',
  'project',
  'linkedReports',
]);

const getTags = (item: Result) => {
  return Object.entries(item).filter(([key]) => !notMetadataKeys.has(key));
};

interface ResultRowProps {
  item: Result;
  tags: ReturnType<typeof getTags>;
  isSelected: boolean;
  onToggle: (resultId: string, checked: boolean) => void;
  onDeleted: () => void;
}

const ResultRow = memo(function ResultRow({
  item,
  tags,
  isSelected,
  onToggle,
  onDeleted,
}: ResultRowProps) {
  const handleCheck = useCallback(
    (checked: boolean | string) => onToggle(item.resultID, checked === true),
    [item.resultID, onToggle]
  );

  return (
    <TableRow>
      <TableCell>
        <Checkbox
          checked={isSelected}
          onCheckedChange={handleCheck}
          aria-label={`Select ${item.title ?? item.resultID}`}
        />
      </TableCell>
      <TableCell className="w-1/4">{item.title ?? item.resultID}</TableCell>
      <TableCell className="w-1/12">{item.project}</TableCell>
      <TableCell className="w-1/12">
        <FormattedDate date={new Date(item.createdAt)} />
      </TableCell>
      <TableCell className="w-1/6">
        {item.linkedReports && item.linkedReports.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {item.linkedReports.slice(0, 3).map((ref) => (
              <Link
                key={ref.reportID}
                to={withBase(`/report/${ref.reportID}`)}
                className="text-xs hover:underline text-primary"
                title={`Open report ${ref.displayNumber ?? ref.reportID}`}
              >
                {ref.displayNumber ? `#${ref.displayNumber}` : ref.reportID.slice(0, 6)}
              </Link>
            ))}
            {item.linkedReports.length > 3 && (
              <span
                className="text-xs text-muted-foreground"
                title={item.linkedReports
                  .slice(3)
                  .map((r) => `#${r.displayNumber ?? r.reportID.slice(0, 6)}`)
                  .join(', ')}
              >
                +{item.linkedReports.length - 3}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="w-1/4">
        <div className="flex flex-wrap gap-1">
          {tags.map(([key, value]) => (
            <Badge key={`${item.resultID}-${key}`} variant="secondary" className="text-xs">
              {`${key}: ${value}`}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell className="w-1/12">{item.size}</TableCell>
      <TableCell className="w-1/12">
        <div className="flex justify-center">
          <DeleteResultsButton resultIds={[item.resultID]} onDeletedResult={onDeleted} />
        </div>
      </TableCell>
    </TableRow>
  );
});

interface ResultsTableProps {
  selected?: string[];
  onSelect?: (results: Result[]) => void;
  onDeleted?: () => void;
}

export default function ResultsTable({
  onSelect,
  onDeleted,
  selected,
}: Readonly<ResultsTableProps>) {
  const resultListEndpoint = '/api/result/list';
  const [searchParams, setSearchParams] = useSearchParams();

  const [project, setProject] = useState(defaultProjectName);
  const [selectedTags, setSelectedTags] = useState<string[]>(() => {
    const raw = searchParams.get('tags');
    return raw ? raw.split(',').filter(Boolean) : [];
  });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const selectedIds = useMemo(() => new Set(selected ?? []), [selected]);
  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
  }));
  const [usage, setUsage] = useState<UsageFilter>(
    () => (searchParams.get('usage') as UsageFilter) || 'all'
  );

  // Reflect filter state into URL search params so the view is shareable.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (selectedTags.length > 0) next.set('tags', selectedTags.join(','));
    else next.delete('tags');
    if (dateRange.from) next.set('from', dateRange.from);
    else next.delete('from');
    if (dateRange.to) next.set('to', dateRange.to);
    else next.delete('to');
    if (usage && usage !== 'all') next.set('usage', usage);
    else next.delete('usage');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [selectedTags, dateRange, usage, searchParams, setSearchParams]);

  const getQueryParams = () => ({
    limit: rowsPerPage.toString(),
    offset: ((page - 1) * rowsPerPage).toString(),
    project,
    ...(selectedTags.length > 0 && { tags: selectedTags.join(',') }),
    ...(search.trim() && { search: search.trim() }),
    ...(dateRange.from && { from: dateRange.from }),
    ...(dateRange.to && { to: dateRange.to }),
    ...(usage && usage !== 'all' && { usage }),
  });

  const {
    data: resultsResponse,
    isPending,
    error,
    refetch,
  } = useQuery<ReadResultsOutput>(withQueryParams(resultListEndpoint, getQueryParams()), {
    dependencies: [
      project,
      selectedTags,
      search,
      rowsPerPage,
      page,
      dateRange.from,
      dateRange.to,
      usage,
    ],
    placeholderData: keepPreviousData,
  });

  const { results, total } = resultsResponse ?? { results: [], total: 0 };

  const rowsWithTags = useMemo(
    () =>
      (results ?? []).map((item) => ({
        item,
        tags: getTags(item),
      })),
    [results]
  );

  const shouldRefetch = useCallback(() => {
    onDeleted?.();
    refetch();
  }, [onDeleted, refetch]);

  const onPageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  const onProjectChange = useCallback((project: string) => {
    setProject(project);
    setPage(1);
  }, []);

  const onTagsChange = useCallback((tags: string[]) => {
    setSelectedTags(tags);
    setPage(1);
  }, []);

  const onSearchChange = useCallback((searchTerm: string) => {
    setSearch(searchTerm);
    setPage(1);
  }, []);

  const onDateRangeChange = useCallback((range: DateRange) => {
    setDateRange(range);
    setPage(1);
  }, []);

  const onUsageChange = useCallback((value: UsageFilter) => {
    setUsage(value);
    setPage(1);
  }, []);

  const pages = useMemo(() => {
    return total ? Math.ceil(total / rowsPerPage) : 0;
  }, [total, rowsPerPage]);

  const handleSelectAll = useCallback(
    (checked: boolean | string) => {
      const isChecked = checked === true;
      const newSelectedIds = isChecked
        ? new Set(results?.map((r) => r.resultID) ?? [])
        : new Set<string>();
      const selectedResults = results?.filter((r) => newSelectedIds.has(r.resultID)) ?? [];
      onSelect?.(selectedResults);
    },
    [results, onSelect]
  );

  const handleSelectRow = useCallback(
    (resultId: string, checked: boolean) => {
      const newSelectedIds = new Set(selectedIds);
      if (checked) {
        newSelectedIds.add(resultId);
      } else {
        newSelectedIds.delete(resultId);
      }
      const selectedResults = results?.filter((r) => newSelectedIds.has(r.resultID)) ?? [];
      onSelect?.(selectedResults);
    },
    [selectedIds, results, onSelect]
  );

  const isAllSelected = results?.length > 0 && results.every((r) => selectedIds.has(r.resultID));

  useEffect(() => {
    if (error) toast.error(error.message);
  }, [error]);

  if (isPending && !resultsResponse) {
    return (
      <div className="flex items-center justify-center p-8">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <>
      <TablePaginationOptions
        entity="result"
        rowPerPageOptions={[10, 20, 40, 80, 120]}
        rowsPerPage={rowsPerPage}
        setPage={setPage}
        setRowsPerPage={setRowsPerPage}
        total={total}
        onProjectChange={onProjectChange}
        onSearchChange={onSearchChange}
        onTagsChange={onTagsChange}
        onDateRangeChange={onDateRangeChange}
        selectedProject={project}
        selectedTags={selectedTags}
        selectedDateRange={dateRange}
        extraFilters={
          <Select value={usage} onValueChange={(v) => onUsageChange(v as UsageFilter)}>
            <SelectTrigger className="w-full sm:w-48" aria-label="Filter by usage">
              <SelectValue placeholder="Usage" />
            </SelectTrigger>
            <SelectContent>
              {usageOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <div className="rounded-md border border-border/50 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">
                <Checkbox
                  checked={isAllSelected}
                  onCheckedChange={handleSelectAll}
                  aria-label="Select all"
                />
              </TableHead>
              {columns.map((column) => (
                <TableHead
                  key={column.uid}
                  className={`px-4 py-3 text-sm font-medium text-foreground ${column.uid === 'actions' ? 'text-center' : ''}`}
                >
                  {column.name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rowsWithTags.map(({ item, tags }) => (
              <ResultRow
                key={item.resultID}
                item={item}
                tags={tags}
                isSelected={selectedIds.has(item.resultID)}
                onToggle={handleSelectRow}
                onDeleted={shouldRefetch}
              />
            ))}
            {(!results || results.length === 0) && (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="text-center py-8">
                  <div className="flex flex-col items-center gap-2 py-4">
                    <div className="text-muted-foreground">No results found.</div>
                    {total === 0 && (
                      <div className="text-xs text-muted-foreground max-w-md">
                        Raw blob ZIPs uploaded by Playwright runs. They&apos;re merged into Reports
                        and cleaned up afterwards.
                      </div>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <PaginatedControls
        page={page}
        totalPages={pages}
        onPageChange={onPageChange}
        className="mt-4"
      />
    </>
  );
}

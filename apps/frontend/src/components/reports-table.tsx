import type { DateRange, ReadReportsHistory, ReportHistory } from '@playwright-reports/shared';
import { keepPreviousData } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Pagination,
  PaginationContent,
  PaginationFirst,
  PaginationItem,
  PaginationLast,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
import DeleteReportButton from './delete-report-button';
import EditReportButton from './edit-report-button';
import { BranchIcon, FolderIcon, LinkIcon } from './icons';
import PassRateBar from './pass-rate-bar';
import TablePaginationOptions, { type PassRateFilter } from './table-pagination-options';

const columns = [
  { name: 'Title', uid: 'title' },
  { name: 'Project', uid: 'project' },
  { name: 'Pass Rate', uid: 'passRate' },
  { name: 'Created at', uid: 'createdAt' },
  { name: 'Size', uid: 'size' },
  { name: '', uid: 'actions' },
];

const coreFields = [
  'reportID',
  'title',
  'displayNumber',
  'project',
  'createdAt',
  'size',
  'sizeBytes',
  'options',
  'reportUrl',
  'metadata',
  'startTime',
  'duration',
  'files',
  'projectNames',
  'stats',
  'errors',
  'playwrightVersion',
];

const isPrimitive = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

type MetadataItem = {
  key: string;
  value: string | number;
  icon?: React.ReactNode;
  primary?: boolean;
};

type ReportMetadataFields = {
  branch?: string;
  environment?: string;
  playwrightVersion?: string;
  workingDir?: string;
  metadata?: { actualWorkers?: number };
  machines?: unknown[] | { count?: number };
  [key: string]: unknown;
};

const getMetadataItems = (item: ReportHistory): MetadataItem[] => {
  const metadata: MetadataItem[] = [];

  // Access dynamic properties that come from resultDetails
  const itemWithMetadata = item as ReportHistory & ReportMetadataFields;

  // Primary fields — shown inline up to a small cap
  if (itemWithMetadata.branch) {
    metadata.push({
      key: 'branch',
      value: itemWithMetadata.branch,
      icon: <BranchIcon width={12} height={12} />,
      primary: true,
    });
  }

  if (itemWithMetadata.environment) {
    metadata.push({ key: 'environment', value: itemWithMetadata.environment, primary: true });
  }

  if (itemWithMetadata.playwrightVersion) {
    metadata.push({
      key: 'playwright',
      value: itemWithMetadata.playwrightVersion,
      primary: true,
    });
  }

  const actualWorkers = itemWithMetadata.metadata?.actualWorkers;
  if (actualWorkers !== undefined) {
    metadata.push({
      key: 'workers',
      value: actualWorkers,
      primary: true,
    });
  }

  // Secondary fields — collapsed into popover
  if (itemWithMetadata.workingDir) {
    const dirName = itemWithMetadata.workingDir.split('/').pop() || itemWithMetadata.workingDir;

    metadata.push({
      key: 'workingDir',
      value: dirName,
      icon: <FolderIcon width={12} height={12} />,
    });
  }

  if (Array.isArray(itemWithMetadata.machines)) {
    metadata.push({ key: 'machines', value: itemWithMetadata.machines.length });
  } else if (
    itemWithMetadata.machines &&
    typeof itemWithMetadata.machines === 'object' &&
    typeof itemWithMetadata.machines.count === 'number'
  ) {
    metadata.push({ key: 'machines', value: itemWithMetadata.machines.count });
  }

  // Add any other metadata fields — skip null/undefined/objects/arrays to avoid `[object Object]`
  Object.entries(itemWithMetadata).forEach(([key, value]) => {
    if (coreFields.includes(key)) return;
    if (['environment', 'workingDir', 'branch', 'machines'].includes(key)) return;
    if (!isPrimitive(value)) return;
    metadata.push({ key, value: typeof value === 'boolean' ? String(value) : value });
  });

  return metadata;
};

const MAX_INLINE_META = 3;

function RegressionChip({
  regressions,
}: Readonly<{ regressions?: { newHere: number; resolvedHere: number } }>) {
  if (!regressions) return null;
  const { newHere, resolvedHere } = regressions;
  if (newHere === 0 && resolvedHere === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      {newHere > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full border border-danger/40 bg-danger/5 px-1.5 py-0.5 text-danger font-medium"
          title={`${newHere} new regression${newHere === 1 ? '' : 's'} in this report`}
        >
          ↓ {newHere}
        </span>
      )}
      {resolvedHere > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-full border border-success/40 bg-success/5 px-1.5 py-0.5 text-success font-medium"
          title={`${resolvedHere} regression${resolvedHere === 1 ? '' : 's'} resolved in this report`}
        >
          ↑ {resolvedHere}
        </span>
      )}
    </span>
  );
}

const renderMetaValue = (item: MetadataItem) => {
  const labelless =
    item.key === 'branch' || item.key === 'workingDir' || item.key === 'environment';
  const text = labelless ? `${item.value}` : `${item.key}: ${item.value}`;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      {item.icon}
      <span className="max-w-[180px] truncate">{text}</span>
    </span>
  );
};

interface ReportRowProps {
  item: ReportHistory;
  primary: MetadataItem[];
  overflow: MetadataItem[];
  isSelected: boolean;
  onToggle: (reportId: string, checked: boolean) => void;
  onChanged: () => void;
}

const ReportRow = memo(function ReportRow({
  item,
  primary,
  overflow,
  isSelected,
  onToggle,
  onChanged,
}: ReportRowProps) {
  const handleCheck = useCallback(
    (checked: boolean | string) => onToggle(item.reportID, checked === true),
    [item.reportID, onToggle]
  );

  return (
    <TableRow>
      <TableCell className="py-2">
        <Checkbox
          checked={isSelected}
          onCheckedChange={handleCheck}
          aria-label={`Select report ${item.displayNumber ?? item.reportID}`}
        />
      </TableCell>
      <TableCell className="w-1/3 py-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex flex-row items-center gap-2">
            <Link to={withBase(`/report/${item.reportID}`)} className="hover:underline w-fit">
              <div className="flex flex-row items-center gap-1.5 text-sm font-medium">
                {item.displayNumber ? `#${item.displayNumber}` : ''}
                {item.title && (
                  <span className="text-muted-foreground font-normal">{item.title}</span>
                )}
                <LinkIcon width={12} height={12} />
              </div>
            </Link>
            <RegressionChip regressions={item.regressions} />
          </div>

          {(primary.length > 0 || overflow.length > 0) && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {primary.map((m, i) => (
                <span key={`${item.reportID}-${m.key}`} className="flex items-center gap-2">
                  {renderMetaValue(m)}
                  {i < primary.length - 1 && (
                    <span className="text-muted-foreground/40 text-xs">·</span>
                  )}
                </span>
              ))}
              {overflow.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      aria-label="Show more metadata"
                    >
                      {primary.length > 0 && <span className="text-muted-foreground/40">·</span>}
                      <MoreHorizontal className="h-3.5 w-3.5" />
                      <span>+{overflow.length}</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto max-w-sm space-y-1">
                    {overflow.map((m) => (
                      <div
                        key={`${item.reportID}-overflow-${m.key}`}
                        className="text-xs flex items-center gap-1.5"
                      >
                        {m.icon}
                        <span className="text-muted-foreground">{m.key}:</span>
                        <span className="font-medium break-all">{m.value}</span>
                      </div>
                    ))}
                  </PopoverContent>
                </Popover>
              )}
            </div>
          )}
        </div>
      </TableCell>
      <TableCell className="w-1/6 py-2">{item.project}</TableCell>
      <TableCell className="w-1/12 py-2">
        <PassRateBar
          stats={
            item.stats || {
              total: 0,
              expected: 0,
              unexpected: 0,
              flaky: 0,
              skipped: 0,
              ok: false,
            }
          }
        />
      </TableCell>
      <TableCell className="w-1/6 py-2">
        <FormattedDate date={item.createdAt} />
      </TableCell>
      <TableCell className="w-1/12 py-2">{item.size}</TableCell>
      <TableCell className="w-1/6 py-2">
        <div className="flex gap-2 justify-end">
          <Link to={withBase(item.reportUrl)} target="_blank">
            <Button size="sm">Open report</Button>
          </Link>
          <EditReportButton report={item} onUpdated={onChanged} />
          <DeleteReportButton reportId={item.reportID} onDeleted={onChanged} />
        </div>
      </TableCell>
    </TableRow>
  );
});

interface ReportsTableProps {
  selected?: string[];
  onSelect?: (reports: ReportHistory[]) => void;
  onChange: () => void;
}

export default function ReportsTable({
  selected,
  onSelect,
  onChange,
}: Readonly<ReportsTableProps>) {
  const reportListEndpoint = '/api/report/list';
  const [searchParams, setSearchParams] = useSearchParams();

  const [project, setProject] = useState(() => searchParams.get('project') ?? defaultProjectName);
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');
  const [page, setPage] = useState(() => {
    const raw = Number.parseInt(searchParams.get('page') ?? '1', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  });
  const [rowsPerPage, setRowsPerPage] = useState(() => {
    const raw = Number.parseInt(searchParams.get('perPage') ?? '10', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 10;
  });
  const selectedIds = useMemo(() => new Set(selected ?? []), [selected]);
  const [selectedTags, setSelectedTags] = useState<string[]>(() => {
    const raw = searchParams.get('tags');
    return raw ? raw.split(',').filter(Boolean) : [];
  });
  const [dateRange, setDateRange] = useState<DateRange>(() => ({
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
  }));
  const [passRate, setPassRate] = useState<PassRateFilter>(
    () => (searchParams.get('passRate') as PassRateFilter) || 'all'
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
    if (passRate && passRate !== 'all') next.set('passRate', passRate);
    else next.delete('passRate');
    if (project && project !== defaultProjectName) next.set('project', project);
    else next.delete('project');
    if (search.trim()) next.set('search', search.trim());
    else next.delete('search');
    if (page > 1) next.set('page', String(page));
    else next.delete('page');
    if (rowsPerPage !== 10) next.set('perPage', String(rowsPerPage));
    else next.delete('perPage');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [
    selectedTags,
    dateRange,
    passRate,
    project,
    search,
    page,
    rowsPerPage,
    searchParams,
    setSearchParams,
  ]);

  const queryUrl = useMemo(
    () =>
      withQueryParams(reportListEndpoint, {
        limit: rowsPerPage.toString(),
        offset: ((page - 1) * rowsPerPage).toString(),
        project,
        ...(search.trim() && { search: search.trim() }),
        ...(selectedTags.length > 0 && { tags: selectedTags.join(',') }),
        ...(dateRange.from && { from: dateRange.from }),
        ...(dateRange.to && { to: dateRange.to }),
        ...(passRate && passRate !== 'all' && { passRate }),
      }),
    [rowsPerPage, page, project, search, selectedTags, dateRange.from, dateRange.to, passRate]
  );

  const {
    data: reportResponse,
    isPending,
    error,
    refetch,
  } = useQuery<ReadReportsHistory>(queryUrl, {
    placeholderData: keepPreviousData,
  });

  const { reports } = reportResponse ?? {};
  const total = reportResponse?.total ?? 0;
  const pages = useMemo(() => (total ? Math.ceil(total / rowsPerPage) : 0), [total, rowsPerPage]);

  const sortedRows = useMemo(() => {
    if (!reports) return [];
    return [...reports]
      .sort((a, b) => (b.displayNumber ?? 0) - (a.displayNumber ?? 0))
      .map((item) => {
        const metaItems = getMetadataItems(item);
        const primary = metaItems.filter((m) => m.primary).slice(0, MAX_INLINE_META);
        const overflow = metaItems.filter((m) => !primary.includes(m));
        return { item, primary, overflow };
      });
  }, [reports]);

  const onDeleted = useCallback(() => {
    onChange?.();
    refetch();
  }, [onChange, refetch]);

  const handleSelectAll = useCallback(
    (checked: boolean | string) => {
      onSelect?.(checked === true ? (reports ?? []) : []);
    },
    [reports, onSelect]
  );

  const handleSelectRow = useCallback(
    (reportId: string, checked: boolean) => {
      const next = new Set(selected ?? []);
      if (checked) next.add(reportId);
      else next.delete(reportId);
      onSelect?.(reports?.filter((r) => next.has(r.reportID)) ?? []);
    },
    [selected, reports, onSelect]
  );

  const isAllSelected =
    !!reports && reports.length > 0 && reports.every((r) => selectedIds.has(r.reportID));

  const onPageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  const goToPrevPage = useCallback(() => {
    setPage((p) => (p > 1 ? p - 1 : p));
  }, []);

  const goToNextPage = useCallback(() => {
    setPage((p) => (pages && p < pages ? p + 1 : p));
  }, [pages]);

  const onProjectChange = useCallback((project: string) => {
    setProject(project);
    setPage(1);
  }, []);

  const onSearchChange = useCallback((searchTerm: string) => {
    setSearch(searchTerm);
    setPage(1);
  }, []);

  const onTagsChange = useCallback((tags: string[]) => {
    setSelectedTags(tags);
    setPage(1);
  }, []);

  const onDateRangeChange = useCallback((range: DateRange) => {
    setDateRange(range);
    setPage(1);
  }, []);

  const onPassRateChange = useCallback((value: PassRateFilter) => {
    setPassRate(value);
    setPage(1);
  }, []);

  useEffect(() => {
    if (error) toast.error(error.message);
  }, [error]);

  const renderPagination = () => {
    if (pages <= 1) return null;

    return (
      <div className="flex w-full justify-center mt-4">
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationFirst
                onClick={() => page !== 1 && onPageChange(1)}
                className={page === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
              />
            </PaginationItem>
            <PaginationItem>
              <PaginationPrevious
                onClick={goToPrevPage}
                className={page === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
              />
            </PaginationItem>
            {Array.from({ length: Math.min(pages, 5) }, (_, i) => {
              let pageNum: number;
              if (pages <= 5) {
                pageNum = i + 1;
              } else if (page <= 3) {
                pageNum = i + 1;
              } else if (page >= pages - 2) {
                pageNum = pages - 4 + i;
              } else {
                pageNum = page - 2 + i;
              }

              return (
                <PaginationItem key={pageNum}>
                  <PaginationLink
                    onClick={() => onPageChange(pageNum)}
                    isActive={page === pageNum}
                    className="cursor-pointer"
                  >
                    {pageNum}
                  </PaginationLink>
                </PaginationItem>
              );
            })}
            <PaginationItem>
              <PaginationNext
                onClick={goToNextPage}
                className={page === pages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
              />
            </PaginationItem>
            <PaginationItem>
              <PaginationLast
                onClick={() => page !== pages && onPageChange(pages)}
                className={page === pages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    );
  };

  if (isPending && !reportResponse) {
    return (
      <div className="flex items-center justify-center p-8">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <>
      <TablePaginationOptions
        entity="report"
        rowsPerPage={rowsPerPage}
        setPage={setPage}
        setRowsPerPage={setRowsPerPage}
        total={total}
        onProjectChange={onProjectChange}
        onSearchChange={onSearchChange}
        onTagsChange={onTagsChange}
        onDateRangeChange={onDateRangeChange}
        onPassRateChange={onPassRateChange}
        selectedProject={project}
        selectedTags={selectedTags}
        selectedDateRange={dateRange}
        selectedPassRate={passRate}
      />
      <div className="rounded-md border border-border/50 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">
                <Checkbox
                  checked={isAllSelected}
                  onCheckedChange={handleSelectAll}
                  aria-label="Select all reports on this page"
                />
              </TableHead>
              {columns.map((column) => (
                <TableHead
                  key={column.uid}
                  className="px-4 py-3 text-sm font-medium text-foreground"
                >
                  {column.name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map(({ item, primary, overflow }) => (
              <ReportRow
                key={item.reportID}
                item={item}
                primary={primary}
                overflow={overflow}
                isSelected={selectedIds.has(item.reportID)}
                onToggle={handleSelectRow}
                onChanged={onDeleted}
              />
            ))}
            {(!reports || reports.length === 0) && (
              <TableRow>
                <TableCell
                  colSpan={columns.length + 1}
                  className="text-center py-8 text-muted-foreground"
                >
                  No reports found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {renderPagination()}
    </>
  );
}

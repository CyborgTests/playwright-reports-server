'use client';

import type { DateRange, ReadReportsHistory, ReportHistory } from '@playwright-reports/shared';
import { keepPreviousData } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
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

const getMetadataItems = (item: ReportHistory): MetadataItem[] => {
  const metadata: MetadataItem[] = [];

  // Cast to any to access dynamic properties that come from resultDetails
  const itemWithMetadata = item as any;

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

  if (itemWithMetadata.metadata?.actualWorkers !== undefined) {
    metadata.push({
      key: 'workers',
      value: itemWithMetadata.metadata.actualWorkers,
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

  const [project, setProject] = useState(defaultProjectName);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(selected ?? []));
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
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [selectedTags, dateRange, passRate, searchParams, setSearchParams]);

  const getQueryParams = () => ({
    limit: rowsPerPage.toString(),
    offset: ((page - 1) * rowsPerPage).toString(),
    project,
    ...(search.trim() && { search: search.trim() }),
    ...(selectedTags.length > 0 && { tags: selectedTags.join(',') }),
    ...(dateRange.from && { from: dateRange.from }),
    ...(dateRange.to && { to: dateRange.to }),
    ...(passRate && passRate !== 'all' && { passRate }),
  });

  const {
    data: reportResponse,
    isPending,
    error,
    refetch,
  } = useQuery<ReadReportsHistory>(withQueryParams(reportListEndpoint, getQueryParams()), {
    dependencies: [
      project,
      search,
      rowsPerPage,
      page,
      selectedTags,
      dateRange.from,
      dateRange.to,
      passRate,
    ],
    placeholderData: keepPreviousData,
  });

  const { reports } = reportResponse ?? {};
  const total = reportResponse?.pagination?.total || reportResponse?.total || 0;

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

  const onDeleted = () => {
    onChange?.();
    refetch();
  };

  const handleSelectAll = (checked: boolean | string) => {
    const isChecked = checked === true;
    const newSelectedIds = isChecked
      ? new Set(reports?.map((r) => r.reportID) ?? [])
      : new Set<string>();
    setSelectedIds(newSelectedIds);
    const selectedReports = reports?.filter((r) => newSelectedIds.has(r.reportID)) ?? [];
    onSelect?.(selectedReports);
  };

  const handleSelectRow = (reportId: string, checked: boolean | string) => {
    const isChecked = checked === true;
    const newSelectedIds = new Set(selectedIds);
    if (isChecked) {
      newSelectedIds.add(reportId);
    } else {
      newSelectedIds.delete(reportId);
    }
    setSelectedIds(newSelectedIds);
    const selectedReports = reports?.filter((r) => newSelectedIds.has(r.reportID)) ?? [];
    onSelect?.(selectedReports);
  };

  const isAllSelected =
    !!reports && reports.length > 0 && reports.every((r) => selectedIds.has(r.reportID));

  const onPageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

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

  const pages = useMemo(() => {
    return total ? Math.ceil(total / rowsPerPage) : 0;
  }, [total, rowsPerPage]);

  error && toast.error(error.message);

  const renderPagination = () => {
    if (pages <= 1) return null;

    return (
      <div className="flex w-full justify-center mt-4">
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => page > 1 && onPageChange(page - 1)}
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
                onClick={() => page < pages && onPageChange(page + 1)}
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
            {sortedRows.map(({ item, primary, overflow }) => {
              return (
                <TableRow key={item.reportID}>
                  <TableCell className="py-2">
                    <Checkbox
                      checked={selectedIds.has(item.reportID)}
                      onCheckedChange={(checked) =>
                        handleSelectRow(item.reportID, checked === true)
                      }
                      aria-label={`Select report ${item.displayNumber ?? item.reportID}`}
                    />
                  </TableCell>
                  <TableCell className="w-1/3 py-2">
                    <div className="flex flex-col gap-0.5">
                      <Link
                        to={withBase(`/report/${item.reportID}`)}
                        className="hover:underline w-fit"
                      >
                        <div className="flex flex-row items-center gap-1.5 text-sm font-medium">
                          {item.displayNumber ? `#${item.displayNumber}` : ''}
                          {item.title && (
                            <span className="text-muted-foreground font-normal">{item.title}</span>
                          )}
                          <LinkIcon width={12} height={12} />
                        </div>
                      </Link>

                      {(primary.length > 0 || overflow.length > 0) && (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          {primary.map((m, i) => (
                            <span
                              key={`${item.reportID}-${m.key}`}
                              className="flex items-center gap-2"
                            >
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
                                  {primary.length > 0 && (
                                    <span className="text-muted-foreground/40">·</span>
                                  )}
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
                      <DeleteReportButton reportId={item.reportID} onDeleted={onDeleted} />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
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

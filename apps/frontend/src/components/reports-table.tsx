'use client';

import type { ReadReportsHistory, ReportHistory } from '@playwright-reports/shared';
import { keepPreviousData } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
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
import TablePaginationOptions from './table-pagination-options';

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

const getMetadataItems = (item: ReportHistory) => {
  const metadata: Array<{ key: string; value: string | number; icon?: React.ReactNode }> = [];

  // Cast to any to access dynamic properties that come from resultDetails
  const itemWithMetadata = item as any;

  // Add specific fields in preferred order
  if (itemWithMetadata.environment) {
    metadata.push({ key: 'environment', value: itemWithMetadata.environment });
  }
  if (itemWithMetadata.workingDir) {
    const dirName = itemWithMetadata.workingDir.split('/').pop() || itemWithMetadata.workingDir;

    metadata.push({
      key: 'workingDir',
      value: dirName,
      icon: <FolderIcon width={14} height={14} />,
    });
  }
  if (itemWithMetadata.branch) {
    metadata.push({
      key: 'branch',
      value: itemWithMetadata.branch,
      icon: <BranchIcon width={14} height={14} />,
    });
  }

  if (itemWithMetadata.playwrightVersion) {
    metadata.push({
      key: 'playwright',
      value: itemWithMetadata.playwrightVersion,
    });
  }

  if (itemWithMetadata.metadata?.actualWorkers !== undefined) {
    metadata.push({
      key: 'workers',
      value: itemWithMetadata.metadata.actualWorkers,
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

interface ReportsTableProps {
  onChange: () => void;
}

export default function ReportsTable({ onChange }: Readonly<ReportsTableProps>) {
  const reportListEndpoint = '/api/report/list';
  const [project, setProject] = useState(defaultProjectName);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const getQueryParams = () => ({
    limit: rowsPerPage.toString(),
    offset: ((page - 1) * rowsPerPage).toString(),
    project,
    ...(search.trim() && { search: search.trim() }),
  });

  const {
    data: reportResponse,
    isPending,
    error,
    refetch,
  } = useQuery<ReadReportsHistory>(withQueryParams(reportListEndpoint, getQueryParams()), {
    dependencies: [project, search, rowsPerPage, page],
    placeholderData: keepPreviousData,
  });

  const { reports } = reportResponse ?? {};
  const total = reportResponse?.pagination?.total || reportResponse?.total || 0;

  const onDeleted = () => {
    onChange?.();
    refetch();
  };

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
        selectedProject={project}
      />
      <div className="rounded-md border border-border/50">
        <Table>
          <TableHeader>
            <TableRow>
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
            {reports
              ?.sort((a, b) => (b.displayNumber ?? 0) - (a.displayNumber ?? 0))
              .map((item) => (
                <TableRow key={item.reportID}>
                  <TableCell className="w-1/3">
                    <div className="flex flex-col">
                      <Link to={withBase(`/report/${item.reportID}`)} className="hover:underline">
                        <div className="flex flex-row items-center gap-1 text-sm">
                          {item.displayNumber ? `#${item.displayNumber} ` : ''}
                          {' | '}
                          {item.title ?? ''}
                          <LinkIcon width={14} height={14} />
                        </div>
                      </Link>

                      <div className="flex flex-wrap gap-1 mt-2">
                        {getMetadataItems(item).map(({ key, value, icon }) => {
                          const displayValue =
                            typeof value === 'string' || typeof value === 'number'
                              ? value
                              : JSON.stringify(value);
                          return (
                            <Badge
                              key={`${item.reportID}-${key}`}
                              variant="secondary"
                              className="text-xs h-5 px-2 py-0"
                              title={`${key}: ${displayValue}`}
                            >
                              {icon}
                              <span className="max-w-[150px] truncate">
                                {key === 'branch' || key === 'workingDir'
                                  ? displayValue
                                  : `${key}: ${displayValue}`}
                              </span>
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="w-1/6">{item.project}</TableCell>
                  <TableCell className="w-1/12">
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
                  <TableCell className="w-1/6">
                    <FormattedDate date={item.createdAt} />
                  </TableCell>
                  <TableCell className="w-1/12">{item.size}</TableCell>
                  <TableCell className="w-1/6">
                    <div className="flex gap-2 justify-end">
                      <Link to={withBase(item.reportUrl)} target="_blank">
                        <Button size="sm">Open report</Button>
                      </Link>
                      <DeleteReportButton reportId={item.reportID} onDeleted={onDeleted} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            {(!reports || reports.length === 0) && (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
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

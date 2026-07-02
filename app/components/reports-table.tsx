'use client';

import { useCallback, useState, useMemo } from 'react';
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Button,
  Spinner,
  Pagination,
  LinkIcon,
  Chip,
  type Selection,
  type SortDescriptor,
} from '@heroui/react';
import Link from 'next/link';
import { keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';

import { withBase } from '../lib/url';

import TablePaginationOptions from './table-pagination-options';
import InlineStatsCircle from './inline-stats-circle';

import { withQueryParams } from '@/app/lib/network';
import { defaultLevelName, defaultProjectName } from '@/app/lib/constants';
import useQuery from '@/app/hooks/useQuery';
import DeleteReportButton from '@/app/components/delete-report-button';
import FormattedDate from '@/app/components/date-format';
import { BranchIcon, DownloadIcon, EvidenceIcon, FolderIcon, PdfIcon } from '@/app/components/icons';
import { ReadReportsHistory, ReportHistory } from '@/app/lib/storage';

const columns = [
  { name: 'Title', uid: 'title', sortable: true },
  { name: 'Project', uid: 'project', sortable: true },
  { name: 'Level', uid: 'level', sortable: true },
  { name: 'Pass Rate', uid: 'passRate', sortable: true },
  { name: 'Created at', uid: 'createdAt', sortable: true },
  { name: 'Size', uid: 'size', sortable: true },
  { name: '', uid: 'actions' },
];

const coreFields = [
  'reportID',
  'title',
  'project',
  'level',
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

const formatMetadataValue = (value: any): string => {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
};

const getMetadataItems = (item: ReportHistory) => {
  const metadata: Array<{ key: string; value: any; icon?: React.ReactNode }> = [];

  // Cast to any to access dynamic properties that come from resultDetails
  const itemWithMetadata = item as any;

  // Add specific fields in preferred order
  if (itemWithMetadata.environment) {
    metadata.push({ key: 'environment', value: itemWithMetadata.environment });
  }
  if (itemWithMetadata.workingDir) {
    const dirName = itemWithMetadata.workingDir.split('/').pop() || itemWithMetadata.workingDir;

    metadata.push({ key: 'workingDir', value: dirName, icon: <FolderIcon /> });
  }
  if (itemWithMetadata.branch) {
    metadata.push({ key: 'branch', value: itemWithMetadata.branch, icon: <BranchIcon /> });
  }

  if (itemWithMetadata.playwrightVersion) {
    metadata.push({ key: 'playwright', value: itemWithMetadata.playwrightVersion });
  }

  metadata.push({ key: 'workers', value: itemWithMetadata.metadata?.actualWorkers });

  // Add any other metadata fields
  Object.entries(itemWithMetadata).forEach(([key, value]) => {
    if (!coreFields.includes(key) && !['environment', 'workingDir', 'branch'].includes(key)) {
      // Skip empty objects
      if (value !== null && typeof value === 'object' && Object.keys(value).length === 0) {
        return;
      }
      metadata.push({ key, value });
    }
  });

  return metadata;
};

interface ReportsTableProps {
  onChange: () => void;
  selected?: string[];
  onSelect?: (reports: ReportHistory[]) => void;
  onDeleted?: () => void;
}

export default function ReportsTable({ onChange, selected, onSelect, onDeleted }: Readonly<ReportsTableProps>) {
  const reportListEndpoint = '/api/report/list';
  const [project, setProject] = useState(defaultProjectName);
  const [level, setLevel] = useState(defaultLevelName);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: 'createdAt',
    direction: 'descending',
  });

  const getQueryParams = () => ({
    limit: rowsPerPage.toString(),
    offset: ((page - 1) * rowsPerPage).toString(),
    project,
    level,
    order: sortDescriptor.direction === 'ascending' ? 'asc' : 'desc',
    sortBy: String(sortDescriptor.column ?? 'createdAt'),
    ...(search.trim() && { search: search.trim() }),
    ...(dateFrom && { dateFrom }),
    ...(dateTo && { dateTo }),
  });

  const {
    data: reportResponse,
    isFetching,
    isPending,
    error,
    refetch,
  } = useQuery<ReadReportsHistory>(withQueryParams(reportListEndpoint, getQueryParams()), {
    dependencies: [
      project,
      level,
      search,
      dateFrom,
      dateTo,
      rowsPerPage,
      page,
      sortDescriptor.direction,
      sortDescriptor.column,
    ],
    placeholderData: keepPreviousData,
  });

  const { reports, total } = reportResponse ?? {};

  const handleDeleted = () => {
    onDeleted?.();
    onChange?.();
    refetch();
  };

  const onChangeSelect = (keys: Selection) => {
    if (keys === 'all') {
      const all = reports ?? [];

      onSelect?.(all);
    }

    if (typeof keys === 'string') {
      return;
    }

    const selectedKeys = Array.from(keys);
    const selectedReports = reports?.filter((r) => selectedKeys.includes(r.reportID)) ?? [];

    onSelect?.(selectedReports);
  };

  const onPageChange = useCallback(
    (page: number) => {
      setPage(page);
    },
    [page, rowsPerPage],
  );

  const onProjectChange = useCallback(
    (project: string) => {
      setProject(project);
      setPage(1);
    },
    [page, rowsPerPage],
  );

  const onLevelChange = useCallback((level: string) => {
    setLevel(level);
    setPage(1);
  }, []);

  const onSearchChange = useCallback((searchTerm: string) => {
    setSearch(searchTerm);
    setPage(1);
  }, []);

  const onDateFromChange = useCallback((date: string) => {
    setDateFrom(date);
    setPage(1);
  }, []);

  const onDateToChange = useCallback((date: string) => {
    setDateTo(date);
    setPage(1);
  }, []);

  const onSortChange = useCallback((descriptor: SortDescriptor) => {
    setSortDescriptor(descriptor);
    setPage(1);
  }, []);

  const pages = useMemo(() => {
    return total ? Math.ceil(total / rowsPerPage) : 0;
  }, [project, total, rowsPerPage]);

  error && toast.error(error.message);
  console.log('reports', reports);

  return (
    <>
      <TablePaginationOptions
        dateFrom={dateFrom}
        dateTo={dateTo}
        entity="report"
        rowPerPageOptions={undefined}
        rowsPerPage={rowsPerPage}
        setPage={setPage}
        setRowsPerPage={setRowsPerPage}
        total={total}
        onDateFromChange={onDateFromChange}
        onDateToChange={onDateToChange}
        onLevelChange={onLevelChange}
        onProjectChange={onProjectChange}
        onSearchChange={onSearchChange}
      />
      <Table
        aria-label="Reports"
        bottomContent={
          pages > 1 ? (
            <div className="flex w-full justify-center">
              <Pagination
                isCompact
                showControls
                showShadow
                color="primary"
                page={page}
                total={pages}
                onChange={onPageChange}
              />
            </div>
          ) : null
        }
        classNames={{
          wrapper: 'p-0 border-none shadow-none',
          tr: 'border-b-1 rounded-0',
        }}
        radius="none"
        selectedKeys={selected}
        selectionMode="multiple"
        sortDescriptor={sortDescriptor}
        onSelectionChange={onChangeSelect}
        onSortChange={onSortChange}
      >
        <TableHeader columns={columns}>
          {(column) => (
            <TableColumn
              key={column.uid}
              allowsSorting={(column as { sortable?: boolean }).sortable}
              className="px-3 py-6 text-md text-black dark:text-white font-medium"
            >
              {column.name}
            </TableColumn>
          )}
        </TableHeader>
        <TableBody
          emptyContent="No reports."
          isLoading={isFetching || isPending}
          items={reports ?? []}
          loadingContent={<Spinner />}
        >
          {(item) => (
            <TableRow key={item.reportID}>
              <TableCell className="w-1/3">
                <div className="flex flex-col">
                  {/* Main title and link */}
                  <Link href={withBase(`/report/${item.reportID}`)} prefetch={false}>
                    <div className="flex flex-row items-center">
                      {item.title || item.reportID} <LinkIcon />
                    </div>
                  </Link>

                  {/* Metadata chips below title */}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {getMetadataItems(item).map(({ key, value, icon }, index) => {
                      const formattedValue = formatMetadataValue(value);
                      const displayValue =
                        key === 'branch' || key === 'workingDir' ? formattedValue : `${key}: ${formattedValue}`;

                      return (
                        <Chip
                          key={`${key}-${index}`}
                          className="text-xs h-5"
                          color="default"
                          size="sm"
                          startContent={icon}
                          title={`${key}: ${formattedValue}`}
                          variant="flat"
                        >
                          <span className="max-w-[150px] truncate">{displayValue}</span>
                        </Chip>
                      );
                    })}
                  </div>
                </div>
              </TableCell>
              <TableCell className="w-1/6">{item.project}</TableCell>
              <TableCell className="w-1/12">{item.level}</TableCell>
              <TableCell className="w-1/12">{<InlineStatsCircle stats={item.stats} />}</TableCell>
              <TableCell className="w-1/6">
                <FormattedDate date={item.createdAt} />
              </TableCell>
              <TableCell className="w-1/4">{item.size}</TableCell>
              <TableCell className="w-1/4">
                <div className="flex gap-2 justify-end items-center">
                  <Link href={withBase(item.reportUrl)} prefetch={false} target="_blank">
                    <Button color="primary" size="md">
                      Open report
                    </Button>
                  </Link>
                  <Button
                    isIconOnly
                    aria-label="Download HTML (ZIP)"
                    as="a"
                    download
                    href={withBase(`/api/download/${item.reportID}?format=zip`)}
                    size="md"
                    title="Download HTML (ZIP)"
                    variant="flat"
                  >
                    <DownloadIcon />
                  </Button>
                  <Button
                    isIconOnly
                    aria-label="Export as PDF"
                    as="a"
                    download
                    href={withBase(`/api/download/${item.reportID}?format=pdf`)}
                    size="md"
                    title="Export as PDF"
                    variant="flat"
                  >
                    <PdfIcon />
                  </Button>
                  <Button
                    isIconOnly
                    aria-label="Evidence PDF (test name + screenshot)"
                    as="a"
                    download
                    href={withBase(`/api/download/${item.reportID}?format=evidence`)}
                    size="md"
                    title="Evidence PDF (test name + screenshot)"
                    variant="flat"
                  >
                    <EvidenceIcon />
                  </Button>
                  <DeleteReportButton reportId={item.reportID} onDeleted={handleDeleted} />
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </>
  );
}

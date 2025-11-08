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
} from '@heroui/react';
import Link from 'next/link';
import { keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';

import { withBase } from '../lib/url';

import TablePaginationOptions from './table-pagination-options';
import InlineStatsCircle from './inline-stats-circle';

import { withQueryParams } from '@/app/lib/network';
import { defaultProjectName } from '@/app/lib/constants';
import useQuery from '@/app/hooks/useQuery';
import DeleteReportButton from '@/app/components/delete-report-button';
import FormattedDate from '@/app/components/date-format';
import { BranchIcon, FolderIcon } from '@/app/components/icons';
import { ReadReportsHistory, ReportHistory } from '@/app/lib/storage';

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
      metadata.push({ key, value });
    }
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
    isFetching,
    isPending,
    error,
    refetch,
  } = useQuery<ReadReportsHistory>(withQueryParams(reportListEndpoint, getQueryParams()), {
    dependencies: [project, search, rowsPerPage, page],
    placeholderData: keepPreviousData,
  });

  const { reports, total } = reportResponse ?? {};

  const onDeleted = () => {
    onChange?.();
    refetch();
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

  const onSearchChange = useCallback((searchTerm: string) => {
    setSearch(searchTerm);
    setPage(1);
  }, []);

  const pages = useMemo(() => {
    return total ? Math.ceil(total / rowsPerPage) : 0;
  }, [project, total, rowsPerPage]);

  error && toast.error(error.message);

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
      >
        <TableHeader columns={columns}>
          {(column) => (
            <TableColumn key={column.uid} className="px-3 py-6 text-md text-black dark:text-white font-medium">
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
                    {getMetadataItems(item).map(({ key, value, icon }, index) => (
                      <Chip
                        key={`${key}-${index}`}
                        className="text-xs h-5"
                        color="default"
                        size="sm"
                        startContent={icon}
                        title={`${key}: ${value}`}
                        variant="flat"
                      >
                        <span className="max-w-[150px] truncate">
                          {key === 'branch' || key === 'workingDir' ? value : `${key}: ${value}`}
                        </span>
                      </Chip>
                    ))}
                  </div>
                </div>
              </TableCell>
              <TableCell className="w-1/6">{item.project}</TableCell>
              <TableCell className="w-1/12">{<InlineStatsCircle stats={item.stats} />}</TableCell>
              <TableCell className="w-1/6">
                <FormattedDate date={item.createdAt} />
              </TableCell>
              <TableCell className="w-1/12">{item.size}</TableCell>
              <TableCell className="w-1/6">
                <div className="flex gap-4 justify-end">
                  <Link href={withBase(item.reportUrl)} prefetch={false} target="_blank">
                    <Button color="primary" size="md">
                      Open report
                    </Button>
                  </Link>
                  <DeleteReportButton reportId={item.reportID} onDeleted={onDeleted} />
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </>
  );
}

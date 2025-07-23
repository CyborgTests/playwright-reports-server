'use client';

import { useCallback, useState, useMemo } from 'react';
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Tooltip,
  Button,
  Spinner,
  Pagination,
  LinkIcon,
  Chip,
} from "@heroui/react";
import Link from 'next/link';
import { keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';

import TablePaginationOptions from './table-pagination-options';

import { withQueryParams } from '@/app/lib/network';
import { defaultProjectName } from '@/app/lib/constants';
import useQuery from '@/app/hooks/useQuery';
import DeleteReportButton from '@/app/components/delete-report-button';
import FormattedDate from '@/app/components/date-format';
import { EyeIcon, BranchIcon, FolderIcon } from '@/app/components/icons';
import { ReadReportsHistory, ReportHistory } from '@/app/lib/storage';

const columns = [
  { name: 'Title', uid: 'title' },
  { name: 'Project', uid: 'project' },
  { name: 'Created At', uid: 'createdAt' },
  { name: 'Size', uid: 'size' },
  { name: 'Actions', uid: 'actions' },
];

const coreFields = ['reportID', 'title', 'project', 'createdAt', 'size', 'sizeBytes', 'reportUrl', 'metadata', 'startTime', 'duration', 'files', 'projectNames', 'stats', 'errors'];

const getMetadataItems = (item: ReportHistory) => {
  const metadata: Array<{key: string, value: any, icon?: React.ReactNode}> = [];
  
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
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const getQueryParams = () => ({
    limit: rowsPerPage.toString(),
    offset: ((page - 1) * rowsPerPage).toString(),
    project,
  });

  const {
    data: reportResponse,
    isFetching,
    isPending,
    error,
    refetch,
  } = useQuery<ReadReportsHistory>(withQueryParams(reportListEndpoint, getQueryParams()), {
    dependencies: [project, rowsPerPage, page],
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
      >
        <TableHeader columns={columns}>
          {(column) => (
            <TableColumn key={column.uid} align={column.uid === 'actions' ? 'center' : 'start'}>
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
              <TableCell className="w-1/2">
                <div className="flex flex-col">
                  {/* Main title and link */}
                  <Link href={`/report/${item.reportID}`} prefetch={false}>
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
              <TableCell className="w-1/4">{item.project}</TableCell>
              <TableCell className="w-1/4">
                <FormattedDate date={item.createdAt} />
              </TableCell>
              <TableCell className="w-1/4">{item.size}</TableCell>
              <TableCell className="w-1/4">
                <div className="flex gap-4 justify-end">
                  <Tooltip color="success" content="Open Report" placement="top">
                    <Link href={item.reportUrl} prefetch={false} target="_blank">
                      <Button color="success" size="md">
                        <EyeIcon />
                      </Button>
                    </Link>
                  </Tooltip>
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

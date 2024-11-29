'use client';

import React, { useCallback, useState } from 'react';
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
} from '@nextui-org/react';
import Link from 'next/link';
import { keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';

import TablePaginationOptions from './table-pagination-options';

import { withQueryParams } from '@/app/lib/network';
import { defaultProjectName } from '@/app/lib/constants';
import useQuery from '@/app/hooks/useQuery';
import DeleteReportButton from '@/app/components/delete-report-button';
import FormattedDate from '@/app/components/date-format';
import { EyeIcon } from '@/app/components/icons';
import { ReadReportsOutput } from '@/app/lib/storage';

const columns = [
  { name: 'ID', uid: 'reportID' },
  { name: 'Project', uid: 'project' },
  { name: 'Created At', uid: 'createdAt' },
  { name: 'Size', uid: 'size' },
  { name: 'Actions', uid: 'actions' },
];

interface ReportsTableProps {
  onChange: () => void;
}

export default function ReportsTable({ onChange }: ReportsTableProps) {
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
  } = useQuery<ReadReportsOutput>(withQueryParams(reportListEndpoint, getQueryParams()), {
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

  const pages = React.useMemo(() => {
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
                <Link href={`/report/${item.reportID}`} prefetch={false}>
                  <div className="flex flex-row">
                    {item.reportID} <LinkIcon />
                  </div>
                </Link>
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

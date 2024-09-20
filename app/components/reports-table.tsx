'use client';

import React, { useCallback, useEffect, useState } from 'react';
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
} from '@nextui-org/react';
import Link from 'next/link';

import useQuery from '@/app/hooks/useQuery';
import ErrorMessage from '@/app/components/error-message';
import DeleteReportButton from '@/app/components/delete-report-button';
import FormattedDate from '@/app/components/date-format';
import { EyeIcon } from '@/app/components/icons';
import { type Report } from '@/app/lib/storage';

const columns = [
  { name: 'ID', uid: 'reportID' },
  { name: 'Created At', uid: 'createdAt' },
  { name: 'Actions', uid: 'actions' },
];

interface ReportsTableProps {
  onChange: () => void;
}

export default function ReportsTable({ onChange }: ReportsTableProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const { data: reports, error, isLoading, refetch } = useQuery<Report[]>('/api/report/list');

  const getCurrentPage = () => {
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;

    const view = reports ? reports.slice(startIndex, endIndex) : [];

    return view;
  };

  const [viewReports, setViewReports] = useState<Report[]>(getCurrentPage());

  useEffect(() => {
    if (isLoading) {
      return;
    }
    const view = getCurrentPage();

    setViewReports(view);
  }, [page, reports]);

  const onDeleted = () => {
    refetch();
    onChange?.();
  };

  const onPageChange = useCallback(
    (page: number) => {
      setPage(page);
      setViewReports(getCurrentPage());
    },
    [page, pageSize],
  );

  const pages = React.useMemo(() => {
    return reports?.length ? Math.ceil(reports.length / pageSize) : 0;
  }, [reports?.length, pageSize]);

  return error ? (
    <ErrorMessage message={error.message} />
  ) : (
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
      <TableBody emptyContent="No reports." isLoading={isLoading} items={viewReports ?? []} loadingContent={<Spinner />}>
        {(item) => (
          <TableRow key={item.reportID}>
            <TableCell className="w-1/2">{item.reportID}</TableCell>
            <TableCell className="w-1/4">
              <FormattedDate date={item.createdAt} />
            </TableCell>
            <TableCell className="w-1/4">
              <div className="flex gap-4 justify-end">
                <Tooltip color="success" content="Open Report" placement="top">
                  <Link href={item.reportUrl} target="_blank">
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
  );
}

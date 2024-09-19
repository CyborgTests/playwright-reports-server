'use client';

import React from 'react';
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
  const { data: reports, error, isLoading, refetch } = useQuery<Report[]>('/api/report/list');

  const onDeleted = () => {
    refetch();
    onChange?.();
  };

  return error ? (
    <ErrorMessage message={error.message} />
  ) : (
    <Table aria-label="Reports">
      <TableHeader columns={columns}>
        {(column) => (
          <TableColumn key={column.uid} align={column.uid === 'actions' ? 'center' : 'start'}>
            {column.name}
          </TableColumn>
        )}
      </TableHeader>
      <TableBody emptyContent="No reports." isLoading={isLoading} items={reports ?? []} loadingContent={<Spinner />}>
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

'use client';

import React from 'react';
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Tooltip, Button } from '@nextui-org/react';
import Link from 'next/link';

import DeleteReportButton from '@/app/components/delete-report-button';
import FormattedDate from '@/app/components/date-format';
import { EyeIcon } from '@/app/components/icons';
import { type Report } from '@/app/lib/data';
import { useApiToken } from '@/app/providers';

const columns = [
  { name: 'ID', uid: 'reportID' },
  { name: 'Created At', uid: 'createdAt' },
  { name: 'Actions', uid: 'actions' },
];

interface ReportsTableProps {
  reports: Report[];
}

export default function ReportsTable({ reports }: ReportsTableProps) {
  const { apiToken } = useApiToken();

  return (
    <Table aria-label="Reports">
      <TableHeader columns={columns}>
        {(column) => (
          <TableColumn key={column.uid} align={column.uid === 'actions' ? 'center' : 'start'}>
            {column.name}
          </TableColumn>
        )}
      </TableHeader>
      <TableBody items={reports}>
        {(item) => (
          <TableRow key={item.reportID}>
            <TableCell className="w-1/2">{item.reportID}</TableCell>
            <TableCell className="w-1/4">
              <FormattedDate date={item.createdAt} />
            </TableCell>
            <TableCell className="w-1/4">
              <div className="flex gap-4 justify-center">
                <Tooltip color="success" content="Open Report" placement="top">
                  <Link href={item.reportUrl} target="_blank">
                    <Button color="success" size="md">
                      <EyeIcon />
                    </Button>
                  </Link>
                </Tooltip>
                <DeleteReportButton reportId={item.reportID} token={apiToken} />
              </div>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

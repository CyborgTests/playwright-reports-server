'use client';

import React from 'react';
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Chip } from '@nextui-org/react';

import FormattedDate from '@/app/components/date-format';
import { type Result } from '@/app/lib/data';
import { useApiToken } from '@/app/providers';

const columns = [
  { name: 'ID', uid: 'resultID' },
  { name: 'Created At', uid: 'createdAt' },
  { name: 'Tags', uid: 'tags' },
  { name: 'Actions', uid: 'actions' },
];

const getTags = (item: Result) => {
  return Object.entries(item).filter(([key]) => !['resultID', 'createdAt'].includes(key));
};

interface ResultsTableProps {
  results: Result[];
}

export default function ResultsTable({ results }: ResultsTableProps) {
  const { apiToken } = useApiToken();

  return (
    <Table aria-label="Results">
      <TableHeader columns={columns}>
        {(column) => (
          <TableColumn key={column.uid} align={column.uid === 'actions' ? 'center' : 'start'}>
            {column.name}
          </TableColumn>
        )}
      </TableHeader>
      <TableBody items={results}>
        {(item) => (
          <TableRow key={item.resultID}>
            <TableCell className="w-1/2">{item.resultID}</TableCell>
            <TableCell className="w-1/6">
              <FormattedDate date={new Date(item.createdAt)} />
            </TableCell>
            <TableCell className="w-1/6 overflow-auto">
              {getTags(item).map(([key, value], index) => (
                <Chip key={index} className="m-1" color="primary">{`${key}: ${value}`}</Chip>
              ))}
            </TableCell>
            <TableCell className="w-1/6">
              <div className="flex gap-4 justify-center">
                {
                  //TODO
                }
              </div>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

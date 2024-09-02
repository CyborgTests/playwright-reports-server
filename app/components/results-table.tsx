'use client';

import React from 'react';
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  type Selection,
} from '@nextui-org/react';

import FormattedDate from '@/app/components/date-format';
import { type Result } from '@/app/lib/data';
import DeleteResultsButton from '@/app/components/delete-results-button';

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
  selected?: string[];
  onSelect?: (keys: string[]) => void;
  token: string;
}

export default function ResultsTable({ results, onSelect, selected, token }: ResultsTableProps) {
  const onChangeSelect = (keys: Selection) => {
    if (keys === 'all') {
      const all = results.map((result) => result.resultID);

      onSelect?.(all);
    }

    if (typeof keys === 'string') {
      return;
    }

    const selected = Array.from(keys) as string[];

    onSelect?.(selected);
  };

  return (
    <Table aria-label="Results" selectedKeys={selected} selectionMode="multiple" onSelectionChange={onChangeSelect}>
      <TableHeader columns={columns}>
        {(column) => (
          <TableColumn key={column.uid} align={column.uid === 'actions' ? 'center' : 'start'}>
            {column.name}
          </TableColumn>
        )}
      </TableHeader>
      <TableBody emptyContent="No results" items={results}>
        {(item) => (
          <TableRow key={item.resultID}>
            <TableCell className="w-1/3">{item.resultID}</TableCell>
            <TableCell className="w-1/6">
              <FormattedDate date={new Date(item.createdAt)} />
            </TableCell>
            <TableCell className="w-1/3">
              {getTags(item).map(([key, value], index) => (
                <Chip
                  key={index}
                  className="m-1 p-5 text-nowrap overflow-x-auto"
                  color="primary"
                >{`${key}: ${value}`}</Chip>
              ))}
            </TableCell>
            <TableCell className="w-1/12">
              <div className="flex gap-4 justify-center">
                <DeleteResultsButton resultIds={[item.resultID]} token={token} />
              </div>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

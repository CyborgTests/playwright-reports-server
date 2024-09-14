'use client';

import React, { useEffect } from 'react';
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

import useQuery from '@/app/hooks/useQuery';
import ErrorMessage from '@/app/components/error-message';
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
  refreshId: string;
  selected?: string[];
  onSelect?: (keys: string[]) => void;
  onDeleted?: () => void;
}

export default function ResultsTable({ refreshId, onSelect, onDeleted, selected }: ResultsTableProps) {
  const { data: results, error, isLoading, refetch } = useQuery<Result[]>('/api/result/list');

  useEffect(() => {
    if (!isLoading) {
      refetch();
    }
  }, [refreshId]);

  const shouldRefetch = () => {
    refetch();
    onDeleted?.();
  };

  const onChangeSelect = (keys: Selection) => {
    if (keys === 'all') {
      const all = (results ?? []).map((result) => result.resultID);

      onSelect?.(all);
    }

    if (typeof keys === 'string') {
      return;
    }

    const selected = Array.from(keys) as string[];

    onSelect?.(selected);
  };

  return error ? (
    <ErrorMessage message={error.message} />
  ) : (
    <Table aria-label="Results" selectedKeys={selected} selectionMode="multiple" onSelectionChange={onChangeSelect}>
      <TableHeader columns={columns}>
        {(column) => (
          <TableColumn key={column.uid} align={column.uid === 'actions' ? 'center' : 'start'}>
            {column.name}
          </TableColumn>
        )}
      </TableHeader>
      <TableBody emptyContent="No results" isLoading={isLoading} items={results ?? []}>
        {(item) => (
          <TableRow key={item.resultID}>
            <TableCell className="w-1/3">{item.resultID}</TableCell>
            <TableCell className="w-1/6">
              <FormattedDate date={new Date(item.createdAt)} />
            </TableCell>
            <TableCell className="w-1/3">
              {getTags(item).map(([key, value], index) => (
                <Chip key={index} className="m-1 p-5 text-nowrap" color="primary" size="sm">{`${key}: ${value}`}</Chip>
              ))}
            </TableCell>
            <TableCell className="w-1/12">
              <div className="flex gap-4 justify-center">
                <DeleteResultsButton resultIds={[item.resultID]} onDeletedResult={shouldRefetch} />
              </div>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

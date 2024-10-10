'use client';

import React, { useEffect, useState } from 'react';
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  type Selection,
  Spinner,
  Autocomplete,
  AutocompleteItem,
} from '@nextui-org/react';

import { SearchIcon } from './icons';

import useQuery from '@/app/hooks/useQuery';
import ErrorMessage from '@/app/components/error-message';
import FormattedDate from '@/app/components/date-format';
import { type Result } from '@/app/lib/storage';
import DeleteResultsButton from '@/app/components/delete-results-button';
import { getUniqueProjectsList } from '@/app/lib/storage/format';

const columns = [
  { name: 'ID', uid: 'resultID' },
  { name: 'Project', uid: 'project' },
  { name: 'Created At', uid: 'createdAt' },
  { name: 'Tags', uid: 'tags' },
  { name: 'Actions', uid: 'actions' },
];

const getTags = (item: Result) => {
  return Object.entries(item).filter(([key]) => !['resultID', 'createdAt', 'project'].includes(key));
};

interface ResultsTableProps {
  refreshId: string;
  selected?: string[];
  onSelect?: (results: Result[]) => void;
  onDeleted?: () => void;
}

export default function ResultsTable({ refreshId, onSelect, onDeleted, selected }: ResultsTableProps) {
  const { data: results, error, isLoading, refetch } = useQuery<Result[]>('/api/result/list');

  const projects = getUniqueProjectsList(results ?? []);

  const [projectFilter, setProjectFilter] = useState('');

  const filteredResults = React.useMemo(() => {
    if (projectFilter) {
      return results?.filter((r) => r.project?.includes(projectFilter));
    }

    return results;
  }, [results, projectFilter]);

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
      const all = results ?? [];

      onSelect?.(all);
    }

    if (typeof keys === 'string') {
      return;
    }

    const selectedKeys = Array.from(keys);
    const selectedResults = results?.filter((r) => selectedKeys.includes(r.resultID)) ?? [];

    onSelect?.(selectedResults);
  };

  return error ? (
    <ErrorMessage message={error.message} />
  ) : (
    <>
      <Autocomplete
        allowsCustomValue
        aria-label="filter by project name"
        className="pt-1 mb-5 max-w-[30%]"
        isDisabled={!projects.length}
        placeholder="filter by project name"
        size="lg"
        startContent={<SearchIcon />}
        value={projectFilter}
        onInputChange={(value) => setProjectFilter(value)}
        onSelectionChange={(value) => setProjectFilter(value?.toString() ?? '')}
      >
        {projects.map((project) => (
          <AutocompleteItem key={project}>{project}</AutocompleteItem>
        ))}
      </Autocomplete>
      <Table aria-label="Results" selectedKeys={selected} selectionMode="multiple" onSelectionChange={onChangeSelect}>
        <TableHeader columns={columns}>
          {(column) => (
            <TableColumn key={column.uid} align={column.uid === 'actions' ? 'center' : 'start'}>
              {column.name}
            </TableColumn>
          )}
        </TableHeader>
        <TableBody
          emptyContent="No results."
          isLoading={isLoading}
          items={filteredResults ?? []}
          loadingContent={<Spinner />}
        >
          {(item) => (
            <TableRow key={item.resultID}>
              <TableCell className="w-1/3">{item.resultID}</TableCell>
              <TableCell className="w-1/6">{item.project}</TableCell>
              <TableCell className="w-1/12">
                <FormattedDate date={new Date(item.createdAt)} />
              </TableCell>
              <TableCell className="w-1/3">
                {getTags(item).map(([key, value], index) => (
                  <Chip
                    key={index}
                    className="m-1 p-5 text-nowrap"
                    color="primary"
                    size="sm"
                  >{`${key}: ${value}`}</Chip>
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
    </>
  );
}

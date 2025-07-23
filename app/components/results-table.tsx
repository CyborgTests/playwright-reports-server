'use client';

import { useCallback, useState, useMemo } from 'react';
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
  Pagination,
} from '@heroui/react';
import { keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';

import { withQueryParams } from '@/app/lib/network';
import { defaultProjectName } from '@/app/lib/constants';
import TablePaginationOptions from '@/app/components/table-pagination-options';
import useQuery from '@/app/hooks/useQuery';
import FormattedDate from '@/app/components/date-format';
import { ReadResultsOutput, type Result } from '@/app/lib/storage';
import DeleteResultsButton from '@/app/components/delete-results-button';

const columns = [
  { name: 'Title', uid: 'title' },
  { name: 'Project', uid: 'project' },
  { name: 'Created at', uid: 'createdAt' },
  { name: 'Tags', uid: 'tags' },
  { name: 'Size', uid: 'size' },
  { name: '', uid: 'actions' },
];

const notMetadataKeys = ['resultID', 'title', 'createdAt', 'size', 'sizeBytes', 'project'];

const getTags = (item: Result) => {
  return Object.entries(item).filter(([key]) => !notMetadataKeys.includes(key));
};

interface ResultsTableProps {
  selected?: string[];
  onSelect?: (results: Result[]) => void;
  onDeleted?: () => void;
}

export default function ResultsTable({ onSelect, onDeleted, selected }: Readonly<ResultsTableProps>) {
  const resultListEndpoint = '/api/result/list';
  const [project, setProject] = useState(defaultProjectName);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const getQueryParams = () => ({
    limit: rowsPerPage.toString(),
    offset: ((page - 1) * rowsPerPage).toString(),
    project,
    ...(selectedTags.length > 0 && { tags: selectedTags.join(',') }),
    ...(search.trim() && { search: search.trim() }),
  });

  const {
    data: resultsResponse,
    isFetching,
    isPending,
    error,
    refetch,
  } = useQuery<ReadResultsOutput>(withQueryParams(resultListEndpoint, getQueryParams()), {
    dependencies: [project, selectedTags, search, rowsPerPage, page],
    placeholderData: keepPreviousData,
  });

  const { results, total } = resultsResponse ?? {};

  const shouldRefetch = () => {
    onDeleted?.();
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

  const onTagsChange = useCallback((tags: string[]) => {
    setSelectedTags(tags);
    setPage(1);
  }, []);

  const onSearchChange = useCallback((searchTerm: string) => {
    setSearch(searchTerm);
    setPage(1);
  }, []);

  const pages = useMemo(() => {
    return total ? Math.ceil(total / rowsPerPage) : 0;
  }, [project, total, rowsPerPage]);

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

  error && toast.error(error.message);

  return (
    <>
      <TablePaginationOptions
        entity="result"
        rowPerPageOptions={[10, 20, 40, 80, 120]}
        rowsPerPage={rowsPerPage}
        setPage={setPage}
        setRowsPerPage={setRowsPerPage}
        total={total}
        onProjectChange={onProjectChange}
        onSearchChange={onSearchChange}
        onTagsChange={onTagsChange}
      />
      <Table
        aria-label="Results"
        bottomContent={
          pages > 1 ? (
            <div className="flex w-full justify-center">
              <Pagination
                isCompact
                showControls
                showShadow
                classNames={{
                  base: 'm-0',
                  wrapper: 'shadow-none',
                  item: '!rounded-full mr-4',
                  cursor: '!rounded-full',
                  next: '!rounded-full',
                  prev: '!rounded-full mr-4',
                }}
                color="primary"
                page={page}
                radius="none"
                total={pages}
                variant="bordered"
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
        selectedKeys={selected}
        selectionMode="multiple"
        onSelectionChange={onChangeSelect}
      >
        <TableHeader columns={columns}>
          {(column) => (
            <TableColumn
              key={column.uid}
              align={column.uid === 'actions' ? 'center' : 'start'}
              className="px-3 py-6 text-md text-black dark:text-white font-medium"
            >
              {column.name}
            </TableColumn>
          )}
        </TableHeader>
        <TableBody
          emptyContent="No results."
          isLoading={isFetching || isPending}
          items={results ?? []}
          loadingContent={<Spinner />}
        >
          {(item) => (
            <TableRow key={item.resultID}>
              <TableCell className="w-1/3">{item.title ?? item.resultID}</TableCell>
              <TableCell className="w-1/6">{item.project}</TableCell>
              <TableCell className="w-1/12">
                <FormattedDate date={new Date(item.createdAt)} />
              </TableCell>
              <TableCell className="w-1/3">
                {getTags(item).map(([key, value], index) => (
                  <Chip
                    key={`${key}-${index}`}
                    className="m-1 p-3 text-nowrap bg-[#DAE7F8] dark:bg-[#1E3A8A]"
                    size="sm"
                  >{`${key}: ${value}`}</Chip>
                ))}
              </TableCell>
              <TableCell className="w-1/4">{item.size}</TableCell>
              <TableCell className="w-1/12">
                <div className="flex justify-center">
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

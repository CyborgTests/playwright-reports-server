import type { ReadResultsOutput, Result } from '@playwright-reports/shared';
import { keepPreviousData } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import useQuery from '@/hooks/useQuery';
import { defaultProjectName } from '@/lib/constants';
import { withQueryParams } from '@/lib/network';
import FormattedDate from './date-format';
import DeleteResultsButton from './delete-results-button';
import TablePaginationOptions from './table-pagination-options';

const columns = [
  { name: 'Title', uid: 'title' },
  { name: 'Project', uid: 'project' },
  { name: 'Created at', uid: 'createdAt' },
  { name: 'Tags', uid: 'tags' },
  { name: 'Size', uid: 'size' },
  { name: '', uid: 'actions' },
];

const notMetadataKeys = new Set(['resultID', 'title', 'createdAt', 'size', 'sizeBytes', 'project']);

const getTags = (item: Result) => {
  return Object.entries(item).filter(([key]) => !notMetadataKeys.has(key));
};

interface ResultsTableProps {
  selected?: string[];
  onSelect?: (results: Result[]) => void;
  onDeleted?: () => void;
}

export default function ResultsTable({
  onSelect,
  onDeleted,
  selected,
}: Readonly<ResultsTableProps>) {
  const resultListEndpoint = '/api/result/list';
  const [project, setProject] = useState(defaultProjectName);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(selected ?? []));

  const getQueryParams = () => ({
    limit: rowsPerPage.toString(),
    offset: ((page - 1) * rowsPerPage).toString(),
    project,
    ...(selectedTags.length > 0 && { tags: selectedTags.join(',') }),
    ...(search.trim() && { search: search.trim() }),
  });

  const {
    data: resultsResponse,
    isPending,
    error,
    refetch,
  } = useQuery<ReadResultsOutput>(withQueryParams(resultListEndpoint, getQueryParams()), {
    dependencies: [project, selectedTags, search, rowsPerPage, page],
    placeholderData: keepPreviousData,
  });

  const { results, total } = resultsResponse ?? { results: [], total: 0 };

  const shouldRefetch = () => {
    onDeleted?.();
    refetch();
  };

  const onPageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  const onProjectChange = useCallback((project: string) => {
    setProject(project);
    setPage(1);
  }, []);

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
  }, [total, rowsPerPage]);

  const handleSelectAll = (checked: boolean | string) => {
    const isChecked = checked === true;
    const newSelectedIds = isChecked
      ? new Set(results?.map((r) => r.resultID) ?? [])
      : new Set<string>();
    setSelectedIds(newSelectedIds);
    const selectedResults = results?.filter((r) => newSelectedIds.has(r.resultID)) ?? [];
    onSelect?.(selectedResults);
  };

  const handleSelectRow = (resultId: string, checked: boolean | string) => {
    const isChecked = checked === true;
    const newSelectedIds = new Set(selectedIds);
    if (isChecked) {
      newSelectedIds.add(resultId);
    } else {
      newSelectedIds.delete(resultId);
    }
    setSelectedIds(newSelectedIds);
    const selectedResults = results?.filter((r) => newSelectedIds.has(r.resultID)) ?? [];
    onSelect?.(selectedResults);
  };

  const isAllSelected = results?.length > 0 && results.every((r) => selectedIds.has(r.resultID));

  error && toast.error(error.message);

  const renderPagination = () => {
    if (pages <= 1) return null;

    return (
      <div className="flex w-full justify-center mt-4">
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => page > 1 && onPageChange(page - 1)}
                className={page === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
              />
            </PaginationItem>
            {Array.from({ length: Math.min(pages, 5) }, (_, i) => {
              let pageNum: number;
              if (pages <= 5) {
                pageNum = i + 1;
              } else if (page <= 3) {
                pageNum = i + 1;
              } else if (page >= pages - 2) {
                pageNum = pages - 4 + i;
              } else {
                pageNum = page - 2 + i;
              }

              return (
                <PaginationItem key={pageNum}>
                  <PaginationLink
                    onClick={() => onPageChange(pageNum)}
                    isActive={page === pageNum}
                    className="cursor-pointer"
                  >
                    {pageNum}
                  </PaginationLink>
                </PaginationItem>
              );
            })}
            <PaginationItem>
              <PaginationNext
                onClick={() => page < pages && onPageChange(page + 1)}
                className={page === pages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    );
  };

  if (isPending && !resultsResponse) {
    return (
      <div className="flex items-center justify-center p-8">
        <Spinner size="lg" />
      </div>
    );
  }

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
        selectedProject={project}
      />
      <div className="rounded-md border border-border/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">
                <Checkbox
                  checked={isAllSelected}
                  onCheckedChange={handleSelectAll}
                  aria-label="Select all"
                />
              </TableHead>
              {columns.map((column) => (
                <TableHead
                  key={column.uid}
                  className={`px-4 py-3 text-sm font-medium text-foreground ${column.uid === 'actions' ? 'text-center' : ''}`}
                >
                  {column.name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {results?.map((item) => (
              <TableRow key={item.resultID}>
                <TableCell>
                  <Checkbox
                    checked={selectedIds.has(item.resultID)}
                    onCheckedChange={(checked) => handleSelectRow(item.resultID, checked === true)}
                    aria-label={`Select ${item.title ?? item.resultID}`}
                  />
                </TableCell>
                <TableCell className="w-1/3">{item.title ?? item.resultID}</TableCell>
                <TableCell className="w-1/6">{item.project}</TableCell>
                <TableCell className="w-1/12">
                  <FormattedDate date={new Date(item.createdAt)} />
                </TableCell>
                <TableCell className="w-1/3">
                  <div className="flex flex-wrap gap-1">
                    {getTags(item).map(([key, value]) => (
                      <Badge
                        key={`${item.resultID}-${key}`}
                        variant="secondary"
                        className="text-xs"
                      >
                        {`${key}: ${value}`}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="w-1/4">{item.size}</TableCell>
                <TableCell className="w-1/12">
                  <div className="flex justify-center">
                    <DeleteResultsButton
                      resultIds={[item.resultID]}
                      onDeletedResult={shouldRefetch}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {(!results || results.length === 0) && (
              <TableRow>
                <TableCell
                  colSpan={columns.length + 1}
                  className="text-center py-8 text-muted-foreground"
                >
                  No results found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {renderPagination()}
    </>
  );
}

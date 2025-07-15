import { type ChangeEvent, useCallback } from 'react';
import { Select, SelectItem, Input } from '@heroui/react';

import ProjectSelect from '@/app/components/project-select';
import TagSelect from '@/app/components/tag-select';
import { SearchIcon } from '@/app/components/icons';

interface TablePaginationRowProps {
  total?: number;
  rowsPerPage: number;
  setRowsPerPage: (rows: number) => void;
  setPage: (page: number) => void;
  onProjectChange: (project: string) => void;
  onSearchChange?: (search: string) => void;
  onTagsChange?: (tags: string[]) => void;
  rowPerPageOptions?: number[];
  entity: 'report' | 'result';
}

const defaultRowPerPageOptions = [10, 20, 40];

export default function TablePaginationOptions({
  // total,
  rowsPerPage,
  entity,
  rowPerPageOptions,
  setRowsPerPage,
  setPage,
  onProjectChange,
  onSearchChange,
  onTagsChange,
}: TablePaginationRowProps) {
  const rowPerPageItems = rowPerPageOptions ?? defaultRowPerPageOptions;

  const onRowsPerPageChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const rows = Number(e.target.value);

      setRowsPerPage(rows);
      setPage(1);
    },
    [rowsPerPage],
  );

  return (
    <div className="flex justify-between items-center pb-6">
      {/* <span className="text-default-400 text-small">Total {total ?? 0}</span> */}
      <div className="flex flex-row gap-3 w-full items-end">
        <Input
          className="w-48 bg-transparent"
          endContent={<SearchIcon size={16} />}
          placeholder="Search..."
          variant="bordered"
          onChange={(e) => onSearchChange?.(e.target.value)}
        />
        <ProjectSelect entity={entity} onSelect={onProjectChange} />
        {entity === 'result' && <TagSelect entity={entity} onSelect={onTagsChange} />}
        <Select
          disallowEmptySelection
          className="w-32 min-w-32 bg-transparent"
          label="Rows per page"
          labelPlacement="outside"
          selectedKeys={[rowsPerPage.toString()]}
          variant="bordered"
          onChange={onRowsPerPageChange}
        >
          {rowPerPageItems.map((item) => (
            <SelectItem key={item} textValue={item.toString()}>
              {item}
            </SelectItem>
          ))}
        </Select>
      </div>
    </div>
  );
}


import { type ChangeEvent, useCallback } from 'react';
import { Select, SelectItem } from '@heroui/react';

import ProjectSelect from '@/app/components/project-select';

interface TablePaginationRowProps {
  total?: number;
  rowsPerPage: number;
  setRowsPerPage: (rows: number) => void;
  setPage: (page: number) => void;
  onProjectChange: (project: string) => void;
  rowPerPageOptions?: number[];
  entity: 'report' | 'result';
}

const defaultRowPerPageOptions = [10, 20, 40];

export default function TablePaginationOptions({
  total,
  rowsPerPage,
  entity,
  rowPerPageOptions,
  setRowsPerPage,
  setPage,
  onProjectChange,
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
    <div className="flex justify-between items-center mb-3">
      <span className="text-default-400 text-small">Total {total ?? 0}</span>
      <div className="flex flex-row min-w-[60%] justify-end gap-3">
        <div className="min-w-[50%]">
          <ProjectSelect entity={entity} onSelect={onProjectChange} />
        </div>
        <Select
          disallowEmptySelection
          className="w-36 min-w-36 p-1"
          label="rows per page"
          selectedKeys={[rowsPerPage.toString()]}
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

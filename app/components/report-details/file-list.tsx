'use client';

import { FC, useEffect, useState } from 'react';
import { Accordion, AccordionItem, Spinner } from "@heroui/react";
import { toast } from 'sonner';

import { subtitle } from '../primitives';
import { StatChart } from '../stat-chart';

import renderFileSuitesTree from './suite-tree';
import ReportFilters from './tests-filters';

import { type ReportHistory } from '@/app/lib/storage';
import useQuery from '@/app/hooks/useQuery';
import { pluralize } from '@/app/lib/transformers';

interface FileListProps {
  report?: ReportHistory | null;
}

const FileList: FC<FileListProps> = ({ report }) => {
  const {
    data: history,
    isLoading: isHistoryLoading,
    error: historyError,
  } = useQuery<ReportHistory[]>(`/api/report/trend?limit=10&project=${report?.project ?? ''}`, {
    callback: `/report/${report?.reportID}`,
    dependencies: [report?.reportID],
  });

  const [filteredTests, setFilteredTests] = useState<ReportHistory | undefined>(report!);

  useEffect(() => {
    if (historyError) {
      toast.error(historyError.message);
    }
  }, [historyError]);

  if (!report) {
    return <Spinner color="primary" label="Loading..." />;
  }

  return isHistoryLoading ? (
    <Spinner color="primary" label="Loading test history..." />
  ) : (
    <div>
      <div className="flex flex-row justify-between">
        <h2 className={subtitle()}>File list</h2>
        <ReportFilters report={report!} onChangeFilters={setFilteredTests} />
      </div>
      {!filteredTests?.files?.length ? (
        <p>No files found</p>
      ) : (
        <Accordion variant="bordered">
          {(filteredTests?.files ?? []).map((file) => (
            <AccordionItem
              key={file.fileId}
              aria-label={file.fileName}
              title={
                <p className="flex flex-row gap-5">
                  {file.fileName}
                  <span className="text-gray-500">
                    {file.tests.length} {pluralize(file.tests.length, 'test', 'tests')}
                  </span>
                </p>
              }
            >
              <div className="file-details">
                <StatChart stats={file.stats} />
                <div className="file-tests">
                  <h4 className={subtitle()}>Tests</h4>
                  {renderFileSuitesTree(file, history ?? [])}
                </div>
              </div>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
};

export default FileList;

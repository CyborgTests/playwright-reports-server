'use client';

import React from 'react';
import { Accordion, AccordionItem, Spinner } from '@nextui-org/react';

import { subtitle } from '../primitives';
import { StatChart } from '../stat-chart';

import renderFileSuitesTree from './suite-tree';

import { type ReportHistory } from '@/app/lib/storage';
import useQuery from '@/app/hooks/useQuery';

interface FileListProps {
  report?: ReportHistory | null;
}

const FileList: React.FC<FileListProps> = ({ report }) => {
  const {
    data: history,
    isLoading: isHistoryLoading,
    error: historyError,
  } = useQuery<ReportHistory[]>(`/api/report/trend?limit=10&project=${report?.project ?? ''}`, {
    callback: `/report/${report?.reportID}`,
    dependencies: [report?.reportID],
  });

  if (!report) {
    return <>Loading...</>;
  }

  if (historyError) {
    return <p>Error: {historyError.message}</p>;
  }

  return isHistoryLoading ? (
    <div>
      Loading test history... <Spinner />
    </div>
  ) : (
    <div>
      <h2 className={subtitle()}>File list</h2>
      <Accordion variant="bordered">
        {(report?.files ?? []).map((file) => (
          <AccordionItem key={file.fileId} aria-label={file.fileName} title={file.fileName}>
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
    </div>
  );
};

export default FileList;
